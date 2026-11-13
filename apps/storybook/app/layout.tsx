import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteProvider } from "../components/site-provider.tsx";
import "./globals.css";

export const metadata: Metadata = {
	title: {
		default: "OpenAgentPack Kit",
		template: "%s · OpenAgentPack Kit",
	},
	description: "为百炼 Managed Agent 打造体验页的开发套件：协议、hooks、copy-in 组件、Node server 与管理端。",
};

export default function Layout({ children }: { children: ReactNode }) {
	return (
		<html lang="zh-CN" suppressHydrationWarning>
			<body className="flex flex-col min-h-screen">
				<script>
					{
						"(function(){try{var p=location.pathname.startsWith('/previews/');var d=p?localStorage.getItem('theme')==='dark':location.pathname==='/';var t=d?'dark':'light';if(p)document.documentElement.dataset.kitTheme=t;else localStorage.setItem('theme',t);var c=document.documentElement.classList;c.toggle('dark',d);c.toggle('light',!d);}catch(e){}})();"
					}
				</script>
				<SiteProvider>{children}</SiteProvider>
			</body>
		</html>
	);
}
