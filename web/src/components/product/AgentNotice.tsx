import { useStore } from "@/state/store";

export function AgentNotice() {
  const agentApi = useStore(s => s.agentApi);
  if (agentApi !== "none") return null;
  return (
    <div className="agent-notice" data-testid="agent-notice" role="note">
      <span aria-hidden="true">○</span>
      <div>
        No agent connected. Open this page in ChatGPT's desktop browser (Cmd+Shift+B) or in Chrome 149+ with <code>chrome://flags/#enable-webmcp-testing</code>. The page works as a normal product page either way.
      </div>
    </div>
  );
}
