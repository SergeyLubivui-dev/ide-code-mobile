FROM mcr.microsoft.com/powershell:7.4-ubuntu-22.04
# A real shell needs a real account: with no /etc/passwd entry for the container
# user, ssh quits with "No user exists for uid 1000" and $HOME lookups fall apart.
RUN set -eux; \
    getent group 1000 >/dev/null || groupadd --gid 1000 coder; \
    getent passwd 1000 >/dev/null || useradd --uid 1000 --gid 1000 --home-dir /tmp/home --shell /bin/bash coder; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl git less nano openssh-client; \
    rm -rf /var/lib/apt/lists/*; \
    mkdir -p /workspace; chown 1000:1000 /workspace
COPY sandbox-init /usr/local/bin/sandbox-init
COPY idecode-profile.ps1 /usr/local/bin/idecode-profile.ps1
RUN chmod 0755 /usr/local/bin/sandbox-init; chmod 0644 /usr/local/bin/idecode-profile.ps1
USER 1000:1000
WORKDIR /workspace
ENV HOME=/tmp/home TERM=xterm-256color POWERSHELL_TELEMETRY_OPTOUT=1 POWERSHELL_UPDATECHECK=Off
ENTRYPOINT ["/usr/local/bin/sandbox-init", "pwsh", "-NoLogo", "-NoProfile", "-NoExit", "-File", "/usr/local/bin/idecode-profile.ps1"]
