package engine

import (
	"errors"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path"
	"slices"
	"strings"
	"syscall"
	"unicode/utf8"
)

const MaxFileBytes = 512 << 10
const MaxProjectBytes = 8 << 20
const MaxEntries = 512

type FileInput struct {
	Path string `json:"path"`
	Code string `json:"code"`
}
type File struct {
	ID   string `json:"id"`
	Path string `json:"path"`
	Code string `json:"code"`
	ETag string `json:"etag"`
}

func validPath(p string) error {
	if p == "" || p == "." || len(p) > 512 || !fs.ValidPath(p) || strings.ContainsAny(p, "\\:\x00\r\n") || !utf8.ValidString(p) {
		return problem(422, "invalid_path", "Use a relative slash-separated path without .., backslashes or drive names")
	}
	for _, v := range strings.Split(p, "/") {
		if len(v) > 128 || strings.HasPrefix(v, ".astra-") {
			return problem(422, "invalid_path", "Invalid or reserved path component")
		}
	}
	return nil
}
func fsError(err error) error {
	if errors.Is(err, fs.ErrNotExist) {
		return problem(404, "not_found", "File or directory not found")
	}
	if errors.Is(err, fs.ErrExist) {
		return problem(409, "already_exists", "Path already exists")
	}
	if errors.Is(err, fs.ErrPermission) {
		return problem(403, "path_denied", "Path is not accessible")
	}
	return problem(422, "invalid_file", "Unsafe or unsupported file operation")
}
func (s *Server) makeWorkspace(id string) (*os.Root, error) {
	if e := s.fs.Mkdir(id, 0755); e != nil {
		return nil, e
	}
	root, e := s.fs.OpenRoot(id)
	if e != nil {
		return nil, e
	}
	if e = root.Chown(".", 1000, 1000); e != nil {
		root.Close()
		return nil, e
	}
	return root, nil
}
func checkComponents(root *os.Root, p string) error {
	parts := strings.Split(p, "/")
	for i := range parts {
		info, e := root.Lstat(strings.Join(parts[:i+1], "/"))
		if errors.Is(e, fs.ErrNotExist) {
			break
		}
		if e != nil {
			return fsError(e)
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return problem(422, "unsafe_path", "Symbolic links are not editable through the API")
		}
		if i < len(parts)-1 && !info.IsDir() {
			return problem(422, "invalid_path", "Parent path is not a directory")
		}
	}
	return nil
}
func readSafe(root *os.Root, p string) ([]byte, error) {
	if e := validPath(p); e != nil {
		return nil, e
	}
	if e := checkComponents(root, p); e != nil {
		return nil, e
	}
	// O_NONBLOCK prevents a shell-created FIFO from hanging the API. Root prevents symlink escape even if paths race.
	f, e := root.OpenFile(p, os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if e != nil {
		return nil, fsError(e)
	}
	defer f.Close()
	info, e := f.Stat()
	if e != nil {
		return nil, fsError(e)
	}
	if !info.Mode().IsRegular() {
		return nil, problem(422, "invalid_file", "Only regular text files are supported")
	}
	if info.Size() > MaxFileBytes {
		return nil, problem(413, "file_too_large", "File exceeds 512 KiB")
	}
	b, e := io.ReadAll(io.LimitReader(f, MaxFileBytes+1))
	if e != nil {
		return nil, e
	}
	if len(b) > MaxFileBytes {
		return nil, problem(413, "file_too_large", "File exceeds 512 KiB")
	}
	if !utf8.Valid(b) || slices.Contains(b, byte(0)) {
		return nil, problem(415, "binary_file", "Editor supports UTF-8 text files")
	}
	return b, nil
}
func putAtomic(root *os.Root, p string, b []byte) error {
	if e := validPath(p); e != nil {
		return e
	}
	if e := checkComponents(root, p); e != nil {
		return e
	}
	dir := path.Dir(p)
	if e := root.MkdirAll(dir, 0777); e != nil {
		return fsError(e)
	}
	// Newly-created directories must be writable by the unprivileged shell UID.
	if dir != "." {
		parts := strings.Split(dir, "/")
		for i := range parts {
			if e := root.Chown(strings.Join(parts[:i+1], "/"), 1000, 1000); e != nil {
				return fsError(e)
			}
		}
	}
	tmp := path.Join(dir, ".astra-"+newID())
	f, e := root.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
	if e != nil {
		return fsError(e)
	}
	defer root.Remove(tmp)
	if e = f.Chown(1000, 1000); e == nil {
		_, e = f.Write(b)
	}
	if e == nil {
		e = f.Sync()
	}
	closeErr := f.Close()
	if e != nil {
		return fsError(e)
	}
	if closeErr != nil {
		return closeErr
	}
	if e = root.Rename(tmp, p); e != nil {
		return fsError(e)
	}
	return nil
}
func tag(b []byte) string { return `"` + digest(b) + `"` }
func workspaceTag(files []File) string {
	var b strings.Builder
	for _, f := range files {
		b.WriteString(f.Path)
		b.WriteByte(0)
		b.WriteString(f.ETag)
	}
	return tag([]byte(b.String()))
}
func precondition(r *http.Request, b []byte, exists bool) error {
	if !exists {
		if r.Header.Get("If-None-Match") != "*" {
			return problem(428, "precondition_required", "Creating a file requires If-None-Match: *")
		}
		return nil
	}
	if r.Header.Get("If-None-Match") == "*" {
		return problem(409, "already_exists", "File already exists")
	}
	if r.Header.Get("If-Match") == "" {
		return problem(428, "precondition_required", "Editing requires the current ETag in If-Match")
	}
	if r.Header.Get("If-Match") != tag(b) {
		return problem(409, "conflict", "File changed on the server; refresh or keep your draft")
	}
	return nil
}
func scanFiles(root *os.Root) ([]File, []string, []string, error) {
	files := []File{}
	dirs := []string{}
	omitted := []string{}
	total, n := 0, 0
	err := fs.WalkDir(root.FS(), ".", func(p string, d fs.DirEntry, e error) error {
		if e != nil {
			return fsError(e)
		}
		if p == "." {
			return nil
		}
		n++
		if n > MaxEntries {
			return problem(413, "quota_exceeded", "Workspace has more than 512 entries")
		}
		if e = validPath(p); e != nil {
			omitted = append(omitted, p)
			if d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			dirs = append(dirs, p)
			return nil
		}
		if !d.Type().IsRegular() {
			omitted = append(omitted, p)
			return nil
		}
		b, e := readSafe(root, p)
		if e != nil {
			omitted = append(omitted, p)
			return nil
		}
		total += len(b)
		if total > MaxProjectBytes {
			return problem(413, "quota_exceeded", "Text files exceed 8 MiB")
		}
		files = append(files, File{p, p, string(b), tag(b)})
		return nil
	})
	return files, dirs, omitted, err
}
func (s *Server) fileRoot(r *http.Request, write bool) (*os.Root, func(), error) {
	id := r.PathValue("project")
	unlock := s.lock(id)
	if _, e := s.project(r, write, false); e != nil {
		unlock()
		return nil, nil, e
	}
	root, e := s.fs.OpenRoot(id)
	if e != nil {
		unlock()
		return nil, nil, fsError(e)
	}
	return root, func() { root.Close(); unlock() }, nil
}
func (s *Server) listFiles(w http.ResponseWriter, r *http.Request) error {
	root, done, e := s.fileRoot(r, false)
	if e != nil {
		return e
	}
	defer done()
	files, dirs, omitted, e := scanFiles(root)
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"files": files, "directories": dirs, "omitted": omitted})
}
func (s *Server) readFile(w http.ResponseWriter, r *http.Request) error {
	root, done, e := s.fileRoot(r, false)
	if e != nil {
		return e
	}
	defer done()
	p := r.URL.Query().Get("path")
	b, e := readSafe(root, p)
	if e != nil {
		return e
	}
	w.Header().Set("ETag", tag(b))
	return respond(w, 200, File{p, p, string(b), tag(b)})
}
func (s *Server) writeFile(w http.ResponseWriter, r *http.Request) error {
	root, done, e := s.fileRoot(r, true)
	if e != nil {
		return e
	}
	defer done()
	p := r.URL.Query().Get("path")
	if e = validPath(p); e != nil {
		return e
	}
	var in struct {
		Code string `json:"code"`
	}
	if e = decode(w, r, &in); e != nil {
		return e
	}
	if len(in.Code) > MaxFileBytes {
		return problem(413, "file_too_large", "File exceeds 512 KiB")
	}
	if strings.ContainsRune(in.Code, 0) {
		return problem(415, "binary_file", "Only UTF-8 text is supported")
	}
	old, e := readSafe(root, p)
	exists := e == nil
	var ae *apiError
	if e != nil && (!errors.As(e, &ae) || ae.Status != 404) {
		return e
	}
	if e = precondition(r, old, exists); e != nil {
		return e
	}
	files, dirs, omitted, e := scanFiles(root)
	if e != nil {
		return e
	}
	total := len(in.Code)
	for _, f := range files {
		if f.Path != p {
			total += len(f.Code)
		}
	}
	if total > MaxProjectBytes || !exists && len(files)+len(dirs)+len(omitted) >= MaxEntries {
		return problem(413, "quota_exceeded", "Workspace quota exceeded")
	}
	if e = putAtomic(root, p, []byte(in.Code)); e != nil {
		return e
	}
	if e = s.touch(r); e != nil {
		return e
	}
	s.audit(r, "file.write", p)
	w.Header().Set("ETag", tag([]byte(in.Code)))
	status := 200
	if !exists {
		status = 201
	}
	return respond(w, status, File{p, p, in.Code, tag([]byte(in.Code))})
}
func (s *Server) deleteFile(w http.ResponseWriter, r *http.Request) error {
	root, done, e := s.fileRoot(r, true)
	if e != nil {
		return e
	}
	defer done()
	p := r.URL.Query().Get("path")
	b, e := readSafe(root, p)
	if e != nil {
		return e
	}
	if e = precondition(r, b, true); e != nil {
		return e
	}
	if e = root.Remove(p); e != nil {
		return fsError(e)
	}
	if e = s.touch(r); e != nil {
		return e
	}
	s.audit(r, "file.delete", p)
	return respond(w, 204, nil)
}
func (s *Server) createDirectory(w http.ResponseWriter, r *http.Request) error {
	root, done, e := s.fileRoot(r, true)
	if e != nil {
		return e
	}
	defer done()
	var in struct {
		Path string `json:"path"`
	}
	if e = decode(w, r, &in); e != nil {
		return e
	}
	if e = validPath(in.Path); e != nil {
		return e
	}
	if e = checkComponents(root, in.Path); e != nil {
		return e
	}
	files, dirs, omitted, e := scanFiles(root)
	if e != nil {
		return e
	}
	if len(files)+len(dirs)+len(omitted)+len(strings.Split(in.Path, "/")) > MaxEntries {
		return problem(413, "quota_exceeded", "Too many entries")
	}
	if e = root.MkdirAll(in.Path, 0755); e != nil {
		return fsError(e)
	}
	parts := strings.Split(in.Path, "/")
	for i := range parts {
		if e = root.Chown(strings.Join(parts[:i+1], "/"), 1000, 1000); e != nil {
			return e
		}
	}
	s.audit(r, "directory.create", in.Path)
	return respond(w, 201, map[string]string{"path": in.Path})
}
func (s *Server) renameFile(w http.ResponseWriter, r *http.Request) error {
	root, done, e := s.fileRoot(r, true)
	if e != nil {
		return e
	}
	defer done()
	var in struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if e = decode(w, r, &in); e != nil {
		return e
	}
	if e = validPath(in.To); e != nil {
		return e
	}
	if e = checkComponents(root, in.To); e != nil {
		return e
	}
	b, e := readSafe(root, in.From)
	if e != nil {
		return e
	}
	if e = precondition(r, b, true); e != nil {
		return e
	}
	if _, e = root.Lstat(in.To); !errors.Is(e, fs.ErrNotExist) {
		return problem(409, "already_exists", "Destination exists")
	}
	if e = putAtomic(root, in.To, b); e != nil {
		return e
	}
	if e = root.Remove(in.From); e != nil {
		_ = root.Remove(in.To)
		return fsError(e)
	}
	if e = s.touch(r); e != nil {
		return e
	}
	s.audit(r, "file.rename", in.From+" -> "+in.To)
	return respond(w, 200, File{in.To, in.To, string(b), tag(b)})
}
