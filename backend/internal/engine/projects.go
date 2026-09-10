package engine

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var uuidRE = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

type Metadata struct {
	Name  string   `json:"name"`
	Desc  string   `json:"desc"`
	Theme string   `json:"theme"`
	Tags  []string `json:"tags"`
	Tint  string   `json:"tint"`
}
type Project struct {
	ID string `json:"id"`
	Metadata
	Role        string     `json:"role"`
	UpdatedAt   int64      `json:"updatedAt"`
	Revision    int        `json:"revision"`
	Files       []File     `json:"files"`
	Snaps       []Snapshot `json:"snaps"`
	Directories []string   `json:"directories"`
	Omitted     []string   `json:"omitted"`
}

func validateMetadata(m *Metadata) error {
	m.Name = strings.TrimSpace(m.Name)
	if m.Name == "" || len(m.Name) > 160 || len(m.Desc) > 2000 || len(m.Theme) > 100 || len(m.Tags) > 8 {
		return problem(422, "invalid_project", "Invalid project metadata")
	}
	for _, tag := range m.Tags {
		if len(tag) > 50 {
			return problem(422, "invalid_project", "Tag is too long")
		}
	}
	if m.Tags == nil {
		m.Tags = []string{}
	}
	if !regexp.MustCompile(`^#[0-9a-fA-F]{6}$`).MatchString(m.Tint) {
		m.Tint = "#8fb0ff"
	}
	return nil
}
func (s *Server) project(r *http.Request, write, owner bool) (Project, error) {
	var p Project
	id := r.PathValue("project")
	if !uuidRE.MatchString(id) {
		return p, problem(404, "not_found", "Project not found")
	}
	var meta []byte
	var at time.Time
	err := s.db.QueryRow(r.Context(), `SELECT p.id,p.metadata,p.updated_at,p.revision,CASE WHEN p.owner_id=$2 THEN 'owner' ELSE m.role END
 FROM projects p LEFT JOIN project_members m ON m.project_id=p.id AND m.user_id=$2
 WHERE p.id=$1 AND (p.owner_id=$2 OR m.user_id=$2)`, id, current(r).ID).Scan(&p.ID, &meta, &at, &p.Revision, &p.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, problem(404, "not_found", "Project not found")
	}
	if err != nil {
		return p, err
	}
	if owner && p.Role != "owner" || write && p.Role == "viewer" {
		return p, problem(403, "forbidden", "Insufficient project permissions")
	}
	p.UpdatedAt = at.UnixMilli()
	p.Files = []File{}
	p.Snaps = []Snapshot{}
	p.Directories = []string{}
	p.Omitted = []string{}
	err = json.Unmarshal(meta, &p.Metadata)
	return p, err
}
func (s *Server) listProjects(w http.ResponseWriter, r *http.Request) error {
	rows, e := s.db.Query(r.Context(), `SELECT p.id,p.metadata,p.updated_at,p.revision,CASE WHEN p.owner_id=$1 THEN 'owner' ELSE m.role END FROM projects p LEFT JOIN project_members m ON m.project_id=p.id AND m.user_id=$1 WHERE p.owner_id=$1 OR m.user_id=$1 ORDER BY p.updated_at DESC,p.id LIMIT $2`, current(r).ID, limitQuery(r))
	if e != nil {
		return e
	}
	defer rows.Close()
	list := []Project{}
	for rows.Next() {
		var p Project
		var meta []byte
		var at time.Time
		if e = rows.Scan(&p.ID, &meta, &at, &p.Revision, &p.Role); e != nil {
			return e
		}
		if e = json.Unmarshal(meta, &p.Metadata); e != nil {
			return e
		}
		p.UpdatedAt = at.UnixMilli()
		p.Files = []File{}
		p.Snaps = []Snapshot{}
		list = append(list, p)
	}
	if e = rows.Err(); e != nil {
		return e
	}
	return respond(w, 200, list)
}
func (s *Server) createProject(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Metadata
		Files []FileInput `json:"files"`
	}
	if e := decode(w, r, &in); e != nil {
		return e
	}
	if e := validateMetadata(&in.Metadata); e != nil {
		return e
	}
	if len(in.Files) > MaxEntries {
		return problem(413, "quota_exceeded", "Too many files")
	}
	total := 0
	seen := map[string]bool{}
	for _, f := range in.Files {
		if e := validPath(f.Path); e != nil {
			return e
		}
		if seen[f.Path] {
			return problem(409, "duplicate_path", "Duplicate file path")
		}
		seen[f.Path] = true
		if len(f.Code) > MaxFileBytes {
			return problem(413, "file_too_large", "File exceeds 512 KiB")
		}
		total += len(f.Code)
	}
	if total > MaxProjectBytes {
		return problem(413, "quota_exceeded", "Project exceeds 8 MiB")
	}
	tx, e := s.db.Begin(r.Context())
	if e != nil {
		return e
	}
	defer tx.Rollback(r.Context())
	if _, e = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", current(r).ID); e != nil {
		return e
	}
	var count int
	if e = tx.QueryRow(r.Context(), "SELECT count(*) FROM projects WHERE owner_id=$1", current(r).ID).Scan(&count); e != nil {
		return e
	}
	if count >= 30 {
		return problem(409, "quota_exceeded", "Maximum 30 owned projects")
	}
	id := newID()
	root, e := s.makeWorkspace(id)
	if e != nil {
		return e
	}
	defer root.Close()
	committed := false
	defer func() {
		if !committed {
			_ = s.fs.RemoveAll(id)
		}
	}()
	for _, f := range in.Files {
		if e = putAtomic(root, f.Path, []byte(f.Code)); e != nil {
			return e
		}
	}
	meta, _ := json.Marshal(in.Metadata)
	_, e = tx.Exec(r.Context(), "INSERT INTO projects(id,owner_id,metadata) VALUES($1,$2,$3)", id, current(r).ID, meta)
	if e != nil {
		return e
	}
	if e = tx.Commit(r.Context()); e != nil {
		return e
	}
	committed = true
	r.SetPathValue("project", id)
	s.audit(r, "project.create", "")
	p, e := s.project(r, false, false)
	if e != nil {
		return e
	}
	p.Files, p.Directories, p.Omitted, e = scanFiles(root)
	if e != nil {
		return e
	}
	return respond(w, 201, p)
}
func (s *Server) getProject(w http.ResponseWriter, r *http.Request) error {
	p, e := s.project(r, false, false)
	if e != nil {
		return e
	}
	defer s.lock(p.ID)()
	root, e := s.fs.OpenRoot(p.ID)
	if e != nil {
		return e
	}
	defer root.Close()
	p.Files, p.Directories, p.Omitted, e = scanFiles(root)
	if e != nil {
		return e
	}
	p.Snaps, e = s.snapshots(r)
	if e != nil {
		return e
	}
	w.Header().Set("ETag", workspaceTag(p.Files))
	return respond(w, 200, p)
}
func (s *Server) patchProject(w http.ResponseWriter, r *http.Request) error {
	p, e := s.project(r, true, false)
	if e != nil {
		return e
	}
	var in struct {
		Metadata
		Revision int `json:"revision"`
	}
	if e = decode(w, r, &in); e != nil {
		return e
	}
	if e = validateMetadata(&in.Metadata); e != nil {
		return e
	}
	meta, _ := json.Marshal(in.Metadata)
	result, e := s.db.Exec(r.Context(), "UPDATE projects SET metadata=$1,revision=revision+1,updated_at=now() WHERE id=$2 AND revision=$3", meta, p.ID, in.Revision)
	if e != nil {
		return e
	}
	if result.RowsAffected() == 0 {
		return problem(409, "conflict", "Project changed; refresh before updating")
	}
	s.audit(r, "project.update", "")
	p, e = s.project(r, false, false)
	if e != nil {
		return e
	}
	return respond(w, 200, p)
}
func (s *Server) deleteProject(w http.ResponseWriter, r *http.Request) error {
	p, e := s.project(r, true, true)
	if e != nil {
		return e
	}
	defer s.lock(p.ID)()
	if e = s.terminals.CloseProject(p.ID, ""); e != nil {
		return e
	}
	// A tombstone rename hides the workspace atomically. It is restored if the DB delete fails.
	tomb := "deleted-" + newID()
	if e = s.fs.Rename(p.ID, tomb); e != nil {
		return e
	}
	if _, e = s.db.Exec(r.Context(), "DELETE FROM projects WHERE id=$1", p.ID); e != nil {
		_ = s.fs.Rename(tomb, p.ID)
		return e
	}
	if e = s.fs.RemoveAll(tomb); e != nil {
		return e
	}
	return respond(w, 204, nil)
}
func (s *Server) touch(r *http.Request) error {
	_, e := s.db.Exec(r.Context(), "UPDATE projects SET updated_at=now() WHERE id=$1", r.PathValue("project"))
	return e
}
func (s *Server) listMembers(w http.ResponseWriter, r *http.Request) error {
	p, e := s.project(r, false, true)
	if e != nil {
		return e
	}
	rows, e := s.db.Query(r.Context(), `SELECT u.id,u.email,u.name,'owner' FROM users u JOIN projects p ON p.owner_id=u.id WHERE p.id=$1 UNION ALL SELECT u.id,u.email,u.name,m.role FROM project_members m JOIN users u ON u.id=m.user_id WHERE m.project_id=$1`, p.ID)
	if e != nil {
		return e
	}
	defer rows.Close()
	list := []map[string]string{}
	for rows.Next() {
		var id, email, name, role string
		if e = rows.Scan(&id, &email, &name, &role); e != nil {
			return e
		}
		list = append(list, map[string]string{"id": id, "email": email, "name": name, "role": role})
	}
	if e = rows.Err(); e != nil {
		return e
	}
	return respond(w, 200, list)
}
func (s *Server) putMember(w http.ResponseWriter, r *http.Request) error {
	p, e := s.project(r, true, true)
	if e != nil {
		return e
	}
	defer s.lock(p.ID)()
	var in struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if e = decode(w, r, &in); e != nil {
		return e
	}
	if in.Role != "viewer" && in.Role != "editor" {
		return problem(422, "invalid_role", "Role must be viewer or editor")
	}
	var id string
	e = s.db.QueryRow(r.Context(), "SELECT id FROM users WHERE email=$1", strings.ToLower(strings.TrimSpace(in.Email))).Scan(&id)
	if errors.Is(e, pgx.ErrNoRows) {
		return problem(404, "not_found", "Registered user not found")
	}
	if e != nil {
		return e
	}
	if id == current(r).ID {
		return problem(422, "owner_immutable", "Owner cannot change their own role")
	}
	if e = s.terminals.CloseProject(p.ID, id); e != nil {
		return e
	}
	_, e = s.db.Exec(r.Context(), "INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role", p.ID, id, in.Role)
	if e != nil {
		return e
	}
	s.audit(r, "member."+in.Role, id)
	return respond(w, 200, map[string]string{"id": id, "role": in.Role})
}
func (s *Server) deleteMember(w http.ResponseWriter, r *http.Request) error {
	p, e := s.project(r, true, true)
	if e != nil {
		return e
	}
	defer s.lock(p.ID)()
	id := r.PathValue("user")
	if !uuidRE.MatchString(id) {
		return problem(404, "not_found", "User not found")
	}
	if e = s.terminals.CloseProject(p.ID, id); e != nil {
		return e
	}
	_, e = s.db.Exec(r.Context(), "DELETE FROM project_members WHERE project_id=$1 AND user_id=$2", p.ID, id)
	if e != nil {
		return e
	}
	s.audit(r, "member.revoke", id)
	return respond(w, 204, nil)
}
func (s *Server) listAudit(w http.ResponseWriter, r *http.Request) error {
	p, e := s.project(r, false, true)
	if e != nil {
		return e
	}
	rows, e := s.db.Query(r.Context(), "SELECT user_id,action,path,created_at FROM audit_events WHERE project_id=$1 ORDER BY id DESC LIMIT $2", p.ID, limitQuery(r))
	if e != nil {
		return e
	}
	defer rows.Close()
	list := []map[string]any{}
	for rows.Next() {
		var user, action, path string
		var at time.Time
		if e = rows.Scan(&user, &action, &path, &at); e != nil {
			return e
		}
		list = append(list, map[string]any{"userId": user, "action": action, "path": path, "at": at})
	}
	if e = rows.Err(); e != nil {
		return e
	}
	return respond(w, 200, list)
}
