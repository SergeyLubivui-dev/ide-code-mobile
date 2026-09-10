package engine

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Docker is a deliberately small control-plane client. No user-supplied Docker options, mounts or image names.
type Docker struct{ http *http.Client }
type dockerError struct {
	Status  int
	Message string
}

func (e *dockerError) Error() string { return e.Message }

func NewDocker() *Docker {
	return &Docker{&http.Client{Timeout: 30 * time.Second, Transport: &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", "/var/run/docker.sock")
	}}}}
}
func (d *Docker) call(ctx context.Context, method, path string, input, output any) error {
	var body io.Reader
	if input != nil {
		data, e := json.Marshal(input)
		if e != nil {
			return e
		}
		body = bytes.NewReader(data)
	}
	req, e := http.NewRequestWithContext(ctx, method, "http://docker/v1.47"+path, body)
	if e != nil {
		return e
	}
	req.Header.Set("Content-Type", "application/json")
	res, e := d.http.Do(req)
	if e != nil {
		return e
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
		return &dockerError{res.StatusCode, fmt.Sprintf("Docker %s: %d %s", method, res.StatusCode, string(b))}
	}
	if output != nil {
		return json.NewDecoder(res.Body).Decode(output)
	}
	_, e = io.Copy(io.Discard, res.Body)
	return e
}
func (d *Docker) remove(id string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	err := d.call(ctx, "DELETE", "/containers/"+id+"?force=true", nil, nil)
	var de *dockerError
	if errors.As(err, &de) && de.Status == 404 {
		return nil
	}
	return err
}

// network makes sure the sandbox bridge exists. Terminals live on their own
// network: they reach the internet but not the database, the API or anything
// else on the compose network. A busy host can run out of Docker's predefined
// address pools, so fall back to an explicitly configured subnet.
func (d *Docker) network(ctx context.Context, name, instance, subnet string) error {
	create := func(input map[string]any) error {
		e := d.call(ctx, "POST", "/networks/create", input, nil)
		var de *dockerError
		if errors.As(e, &de) && de.Status == 409 {
			return nil
		}
		return e
	}
	input := map[string]any{"Name": name, "Driver": "bridge", "CheckDuplicate": true,
		"Labels": map[string]string{"astra.engine": instance}}
	e := create(input)
	if e == nil || subnet == "" {
		return e
	}
	input["IPAM"] = map[string]any{"Driver": "default", "Config": []map[string]any{{"Subnet": subnet}}}
	if retry := create(input); retry != nil {
		return fmt.Errorf("%w (retry with subnet %s: %v)", e, subnet, retry)
	}
	return nil
}
func (d *Docker) resize(id string, cols, rows int) error {
	if cols < 2 || cols > 500 || rows < 2 || rows > 200 {
		return problem(422, "invalid_size", "Terminal size is out of range")
	}
	ctx, c := context.WithTimeout(context.Background(), 5*time.Second)
	defer c()
	return d.call(ctx, "POST", fmt.Sprintf("/containers/%s/resize?w=%d&h=%d", id, cols, rows), nil, nil)
}
func (d *Docker) create(ctx context.Context, cfg Config, project, id string) (string, error) {
	input := map[string]any{
		"Image": cfg.Image, "Hostname": "workspace", "User": "1000:1000", "WorkingDir": "/workspace",
		"Cmd": []string{"pwsh", "-NoLogo", "-NoProfile", "-NoExit", "-File", "/usr/local/bin/idecode-profile.ps1"}, "Entrypoint": []string{"/usr/local/bin/sandbox-init"}, "Tty": true, "OpenStdin": true, "StdinOnce": false, "AttachStdin": true, "AttachStdout": true, "AttachStderr": true,
		"Env":    []string{"HOME=/tmp/home", "TERM=xterm-256color", "LANG=C.UTF-8", "POWERSHELL_TELEMETRY_OPTOUT=1", "POWERSHELL_UPDATECHECK=Off", "DOTNET_CLI_TELEMETRY_OPTOUT=1"},
		"Labels": map[string]string{"astra.engine": cfg.Instance, "astra.project": project, "astra.terminal": id},
		"HostConfig": map[string]any{"NetworkMode": cfg.SandboxNetwork, "ReadonlyRootfs": true, "CapDrop": []string{"ALL"}, "SecurityOpt": []string{"no-new-privileges:true"}, "Memory": 512 << 20, "MemorySwap": 512 << 20, "NanoCpus": 1000000000, "PidsLimit": 128, "Init": true,
			"LogConfig": map[string]any{"Type": "none"}, "Ulimits": []map[string]any{{"Name": "nofile", "Soft": 1024, "Hard": 1024}},
			"Tmpfs":  map[string]string{"/tmp": "rw,nosuid,nodev,size=64m,mode=1777"},
			"Mounts": []map[string]any{{"Type": "volume", "Source": cfg.Volume, "Target": "/workspace", "VolumeOptions": map[string]any{"NoCopy": true, "Subpath": project}}}}}
	var out struct {
		ID string `json:"Id"`
	}
	e := d.call(ctx, "POST", "/containers/create?name="+url.QueryEscape("astracode-"+cfg.Instance+"-"+id), input, &out)
	return out.ID, e
}

type attachment struct {
	net.Conn
	reader *bufio.Reader
}

func (a *attachment) Read(b []byte) (int, error) { return a.reader.Read(b) }
func (d *Docker) attach(ctx context.Context, id string) (*attachment, error) {
	conn, e := (&net.Dialer{}).DialContext(ctx, "unix", "/var/run/docker.sock")
	if e != nil {
		return nil, e
	}
	_ = conn.SetDeadline(time.Now().Add(15 * time.Second))
	req, e := http.NewRequest("POST", "http://docker/v1.47/containers/"+id+"/attach?stream=1&stdin=1&stdout=1&stderr=1", nil)
	if e != nil {
		conn.Close()
		return nil, e
	}
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "tcp")
	if e = req.Write(conn); e != nil {
		conn.Close()
		return nil, e
	}
	reader := bufio.NewReader(conn)
	res, e := http.ReadResponse(reader, req)
	if e != nil {
		conn.Close()
		return nil, e
	}
	if res.StatusCode != 101 && res.StatusCode != 200 {
		conn.Close()
		return nil, fmt.Errorf("Docker attach: %s", res.Status)
	}
	_ = conn.SetDeadline(time.Time{})
	return &attachment{conn, reader}, nil
}
func (d *Docker) cleanup(ctx context.Context, instance string) error {
	filters, _ := json.Marshal(map[string][]string{"label": {"astra.engine=" + instance}})
	var list []struct {
		ID string `json:"Id"`
	}
	if e := d.call(ctx, "GET", "/containers/json?all=true&filters="+url.QueryEscape(string(filters)), nil, &list); e != nil {
		return e
	}
	for _, c := range list {
		if !strings.ContainsAny(c.ID, "/?.") {
			if e := d.remove(c.ID); e != nil {
				return e
			}
		}
	}
	return nil
}
