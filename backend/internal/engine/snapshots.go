package engine

import (
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strings"
	"time"
)

type SnapshotFile struct {
	Path  string `json:"path"`
	Lines int    `json:"lines"`
}
type Snapshot struct {
	ID    string         `json:"id"`
	Hash  string         `json:"hash"`
	Msg   string         `json:"msg"`
	Who   string         `json:"who"`
	At    int64          `json:"at"`
	Files []SnapshotFile `json:"files"`
}

func (s *Server) snapshots(r *http.Request) ([]Snapshot, error) {
	// History sends paths and line counts, not up to 20 full copies of the workspace.
	rows, e := s.db.Query(r.Context(), `SELECT s.id,s.message,u.email,s.created_at,
 coalesce((SELECT jsonb_agg(jsonb_build_object('path',f->>'path','lines',length(f->>'code')-length(replace(f->>'code',chr(10),''))+1)) FROM jsonb_array_elements(s.files) f),'[]'::jsonb),
 substr(encode(sha256(convert_to(s.files::text,'UTF8')),'hex'),1,8)
 FROM snapshots s JOIN users u ON u.id=s.user_id WHERE s.project_id=$1 ORDER BY s.created_at DESC`, r.PathValue("project"))
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	list := []Snapshot{}
	for rows.Next() {
		var sn Snapshot
		var at time.Time
		var data []byte
		if e = rows.Scan(&sn.ID, &sn.Msg, &sn.Who, &at, &data, &sn.Hash); e != nil {
			return nil, e
		}
		sn.At = at.UnixMilli()
		if e = json.Unmarshal(data, &sn.Files); e != nil {
			return nil, e
		}
		list = append(list, sn)
	}
	return list, rows.Err()
}
func (s *Server) listSnapshots(w http.ResponseWriter, r *http.Request) error {
	if _, e := s.project(r, false, false); e != nil {
		return e
	}
	list, e := s.snapshots(r)
	if e != nil {
		return e
	}
	return respond(w, 200, list)
}
func (s *Server) createSnapshot(w http.ResponseWriter, r *http.Request) error {
	root, done, e := s.fileRoot(r, true)
	if e != nil {
		return e
	}
	defer done()
	var in struct {
		Message string   `json:"message"`
		Paths   []string `json:"paths"`
	}
	if e = decode(w, r, &in); e != nil {
		return e
	}
	if in.Message == "" || len(in.Message) > 500 {
		return problem(422, "invalid_message", "Snapshot message is required, at most 500 bytes")
	}
	var count int
	if e = s.db.QueryRow(r.Context(), "SELECT count(*) FROM snapshots WHERE project_id=$1", r.PathValue("project")).Scan(&count); e != nil {
		return e
	}
	if count >= 20 {
		return problem(409, "quota_exceeded", "Maximum 20 snapshots per project")
	}
	files, _, _, e := scanFiles(root)
	if e != nil {
		return e
	}
	selected := map[string]bool{}
	for _, p := range in.Paths {
		if e = validPath(p); e != nil {
			return e
		}
		selected[p] = true
	}
	saved := []FileInput{}
	for _, f := range files {
		if len(in.Paths) == 0 || selected[f.Path] {
			saved = append(saved, FileInput{f.Path, f.Code})
			delete(selected, f.Path)
		}
	}
	if len(selected) > 0 {
		return problem(404, "not_found", "A selected file is missing or not editable")
	}
	data, _ := json.Marshal(saved)
	id := newID()
	var at time.Time
	var hash string
	e = s.db.QueryRow(r.Context(), "INSERT INTO snapshots(id,project_id,user_id,message,files) VALUES($1,$2,$3,$4,$5) RETURNING created_at,substr(encode(sha256(convert_to(files::text,'UTF8')),'hex'),1,8)", id, r.PathValue("project"), current(r).ID, in.Message, data).Scan(&at, &hash)
	if e != nil {
		return e
	}
	s.audit(r, "snapshot.create", id)
	index := []SnapshotFile{}
	for _, f := range saved {
		index = append(index, SnapshotFile{f.Path, strings.Count(f.Code, "\n") + 1})
	}
	return respond(w, 201, Snapshot{id, hash, in.Message, current(r).Email, at.UnixMilli(), index})
}
func (s *Server) restoreSnapshot(w http.ResponseWriter, r *http.Request) error {
	root, done, e := s.fileRoot(r, true)
	if e != nil {
		return e
	}
	defer done()
	id := r.PathValue("snapshot")
	if !uuidRE.MatchString(id) {
		return problem(404, "not_found", "Snapshot not found")
	}
	var in struct {
		Path string `json:"path"`
	}
	if e = decode(w, r, &in); e != nil {
		return e
	}
	var data []byte
	e = s.db.QueryRow(r.Context(), "SELECT files FROM snapshots WHERE id=$1 AND project_id=$2", id, r.PathValue("project")).Scan(&data)
	if errors.Is(e, pgx.ErrNoRows) {
		return problem(404, "not_found", "Snapshot not found")
	}
	if e != nil {
		return e
	}
	files, dirs, omitted, e := scanFiles(root)
	if e != nil {
		return e
	}
	if r.Header.Get("If-Match") == "" {
		return problem(428, "precondition_required", "Restore requires workspace ETag from GET project")
	}
	if r.Header.Get("If-Match") != workspaceTag(files) {
		return problem(409, "conflict", "Workspace changed before restore")
	}
	if s.terminals.HasProject(r.PathValue("project")) {
		return problem(409, "terminal_active", "Close project terminals before restoring files")
	}
	var saved []FileInput
	if e = json.Unmarshal(data, &saved); e != nil {
		return e
	}
	chosen := []FileInput{}
	for _, f := range saved {
		if in.Path == "" || f.Path == in.Path {
			chosen = append(chosen, f)
		}
	}
	if in.Path != "" && len(chosen) == 0 {
		return problem(404, "not_found", "File is not in this snapshot")
	}
	sizes := map[string]int{}
	for _, f := range files {
		sizes[f.Path] = len(f.Code)
	}
	for _, f := range chosen {
		if e = checkComponents(root, f.Path); e != nil {
			return e
		}
		sizes[f.Path] = len(f.Code)
	}
	total := 0
	for _, n := range sizes {
		total += n
	}
	if total > MaxProjectBytes || len(sizes)+len(dirs)+len(omitted) > MaxEntries {
		return problem(413, "quota_exceeded", "Restore would exceed workspace quota")
	}
	// Each file is atomic; snapshot restore is a merge, preserving files not selected. A failed disk write can produce a partial merge.
	for _, f := range chosen {
		if e = putAtomic(root, f.Path, []byte(f.Code)); e != nil {
			return e
		}
	}
	if e = s.touch(r); e != nil {
		return e
	}
	s.audit(r, "snapshot.restore", id)
	return respond(w, 200, map[string]int{"restored": len(chosen)})
}
