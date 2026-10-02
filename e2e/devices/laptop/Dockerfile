# A teammate's laptop: Node, warren-cli installed from the packed tarball
# (what `npx warren-cli` would fetch), a stub `codex` and a fake Claude Code host.
FROM node:22-bookworm-slim
COPY warren-cli.tgz /tmp/warren-cli.tgz
RUN npm install -g /tmp/warren-cli.tgz --no-audit --no-fund
COPY codex fake-claude.mjs /usr/local/bin/
RUN chmod +x /usr/local/bin/codex /usr/local/bin/fake-claude.mjs && mkdir -p /work
WORKDIR /work
CMD ["sleep", "infinity"]
