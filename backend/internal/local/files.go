package local

import (
	"errors"
	"io/fs"
	"os"
	"path"
	"slices"
	"strings"
	"unicode/utf8"
)

// Правила путей те же, что и на сервере: относительный путь со слэшами,
// без .., обратных слэшей и служебных имён.
func validPath(p string) error {
	if p == "" || p == "." || len(p) > 512 || !fs.ValidPath(p) ||
		strings.ContainsAny(p, "\\:\x00\r\n") || !utf8.ValidString(p) {
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
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return problem(404, "not_found", "File or directory not found")
	case errors.Is(err, fs.ErrExist):
		return problem(409, "already_exists", "Path already exists")
	case errors.Is(err, fs.ErrPermission):
		return problem(403, "path_denied", "Path is not accessible")
	}
	return problem(422, "invalid_file", "Unsafe or unsupported file operation")
}

func (s *Server) workspace(id string) (*os.Root, error) {
	root, e := s.fs.OpenRoot(id)
	if e != nil {
		return nil, fsError(e)
	}
	return root, nil
}

func (s *Server) makeWorkspace(id string) (*os.Root, error) {
	if e := s.fs.Mkdir(id, 0o700); e != nil {
		return nil, e
	}
	return s.fs.OpenRoot(id)
}

// Символические ссылки не редактируются: иначе запись ушла бы за пределы проекта.
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
	}
	return nil
}

func mkdirAll(root *os.Root, dir string) error {
	if dir == "." || dir == "" {
		return nil
	}
	parts := strings.Split(dir, "/")
	for i := range parts {
		p := strings.Join(parts[:i+1], "/")
		if e := root.Mkdir(p, 0o700); e != nil && !errors.Is(e, fs.ErrExist) {
			return fsError(e)
		}
	}
	return nil
}

func readFile(root *os.Root, p string) ([]byte, error) {
	f, e := root.Open(p)
	if e != nil {
		return nil, fsError(e)
	}
	defer f.Close()
	info, e := f.Stat()
	if e != nil {
		return nil, fsError(e)
	}
	if info.IsDir() {
		return nil, problem(422, "invalid_file", "Path is a directory")
	}
	if info.Size() > MaxFileBytes {
		return nil, problem(413, "file_too_large", "File exceeds 512 KiB")
	}
	b := make([]byte, info.Size())
	if _, e = f.Read(b); e != nil && info.Size() > 0 {
		return nil, fsError(e)
	}
	return b, nil
}

// Запись через временный файл в той же папке — редактор не должен получить
// половину файла, если процесс убьют на середине.
func writeFile(root *os.Root, p string, body []byte) error {
	if e := mkdirAll(root, path.Dir(p)); e != nil {
		return e
	}
	tmp := path.Join(path.Dir(p), ".astra-tmp-"+path.Base(p))
	if tmp == p {
		return problem(422, "invalid_path", "Invalid path")
	}
	f, e := root.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if e != nil {
		return fsError(e)
	}
	if _, e = f.Write(body); e != nil {
		f.Close()
		_ = root.Remove(tmp)
		return fsError(e)
	}
	if e = f.Close(); e != nil {
		_ = root.Remove(tmp)
		return fsError(e)
	}
	if e = root.Rename(tmp, p); e != nil {
		_ = root.Remove(tmp)
		return fsError(e)
	}
	return nil
}

// scan возвращает то же, что серверный обход: файлы, каталоги и пропущенное.
func scan(root *os.Root) ([]File, []string, []string, error) {
	files := []File{}
	dirs := []string{}
	omitted := []string{}
	total, count := 0, 0
	err := fs.WalkDir(root.FS(), ".", func(p string, d fs.DirEntry, e error) error {
		if e != nil {
			return nil
		}
		if p == "." {
			return nil
		}
		if strings.HasPrefix(path.Base(p), ".astra-") {
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
		info, e := d.Info()
		if e != nil {
			return nil
		}
		if count >= MaxEntries || info.Size() > MaxFileBytes || total+int(info.Size()) > MaxProjectBytes {
			omitted = append(omitted, p)
			return nil
		}
		b, e := readFile(root, p)
		if e != nil {
			omitted = append(omitted, p)
			return nil
		}
		if !utf8.Valid(b) {
			omitted = append(omitted, p)
			return nil
		}
		count++
		total += len(b)
		files = append(files, File{ID: digest([]byte(p))[:12], Path: p, Code: string(b), ETag: tagOf(b)})
		return nil
	})
	slices.Sort(dirs)
	slices.Sort(omitted)
	slices.SortFunc(files, func(a, b File) int { return strings.Compare(a.Path, b.Path) })
	return files, dirs, omitted, err
}

func removeAll(root *os.Root, p string) error {
	info, e := root.Lstat(p)
	if e != nil {
		return fsError(e)
	}
	if info.IsDir() {
		entries, e := fs.ReadDir(root.FS(), p)
		if e != nil {
			return fsError(e)
		}
		for _, entry := range entries {
			if e = removeAll(root, path.Join(p, entry.Name())); e != nil {
				return e
			}
		}
	}
	if e = root.Remove(p); e != nil {
		return fsError(e)
	}
	return nil
}
