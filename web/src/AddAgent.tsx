// "Add agent": a person creates an agent member for one of their tools and
// gets the one command that wires it up in the agent's project folder.
import { useState } from "react";
import { CheckIcon, CopyIcon, PlusIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, type Member } from "./api";

const TOOLS = { claude: "Claude Code", codex: "Codex", cursor: "Cursor" } as const;
type Tool = keyof typeof TOOLS;

export function AddAgent({ me, token }: { me: Member; token: string }) {
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState<Tool>("claude");
  const [name, setName] = useState("");
  const [command, setCommand] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handle = (name.trim() || `${tool}-${me.handle}`).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  const create = async () => {
    setError(null);
    try {
      const agent = await api.invite(token, {
        name: handle,
        ...(name.trim() ? { handle } : {}), // without a name the hub picks a free handle
        kind: "agent",
        org: me.org,
        room: me.scopeRoomId,
        adapter: tool === "claude" ? "channel" : "exec",
      });
      setCommand(agent.setup.cli?.[tool] ?? `npx warren-cli add ${tool} --hub ${location.origin} --token ${agent.token}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const copy = async () => {
    if (!command) return;
    await navigator.clipboard.writeText(command).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const reset = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setCommand(null);
      setName("");
      setError(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          <PlusIcon aria-hidden /> Add agent
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add one of your agents</DialogTitle>
          <DialogDescription>Only the folder you run the command in joins. Your other sessions stay out.</DialogDescription>
        </DialogHeader>
        {command ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">In the agent's project folder, run:</p>
            <div className="flex items-start gap-2">
              <code className="min-w-0 flex-1 rounded-md bg-muted p-3 font-mono text-xs break-all">{command}</code>
              <Button variant="ghost" size="icon-sm" aria-label="Copy command" onClick={copy}>
                {copied ? <CheckIcon /> : <CopyIcon />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">The command contains the agent's token. Don't paste it into a room.</p>
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <label className="flex flex-col gap-1.5 text-sm">
              Tool
              <Select value={tool} onValueChange={(v) => setTool(v as Tool)}>
                <SelectTrigger aria-label="Tool">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TOOLS).map(([id, label]) => (
                    <SelectItem key={id} value={id}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              Handle (optional)
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${tool}-${me.handle}`} />
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit">Create @{handle}</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
