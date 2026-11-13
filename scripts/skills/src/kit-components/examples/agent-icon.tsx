import { isIconImageSource } from "@openagentpack/kit-chat-ui";

// Keep the shared image-or-text rule when the application owns the icon layout.
export function AgentIcon({ icon }: { icon?: string }) {
	return <span aria-hidden>{isIconImageSource(icon) ? <img src={icon} alt="" /> : (icon ?? "🤖")}</span>;
}
