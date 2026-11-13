import { fileURLToPath } from "node:url";
import {
	PROTOCOL_VERSION,
	type ProjectAgentCreateInput,
	type ProjectSkillUpload,
	type ProjectSkillUploadInput,
} from "@openagentpack/kit-sdk/protocol";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { ADMIN_TOKEN, openConsoleNavigation } from "./helpers.ts";
import { installAgentPublishReviewFixture } from "./template-agent-publish-fixture.ts";
import {
	closeTemplateAgentPicker,
	confirmTemplateAgentSelection,
	installTemplateAgentDetailFixture,
	openTemplateAgentPicker,
} from "./template-agent-selection-helpers.ts";
import { selectInlineEnvironment } from "./template-inline-helpers.ts";
import { installResourceDraftFixture, resourceDraftFixture } from "./template-resource-draft-fixture.ts";

const apiBase = "https://template-agent-skill-upload.example/kit";
const projectPath = "/api/admin/resource-drafts/resource-draft-1/resources";
const uploadPath = `${projectPath}/skill-uploads`;
const guidePackage = fileURLToPath(new URL("./fixtures/skills/guide.zip", import.meta.url));
const notesFile = {
	name: "SKILL.md",
	mimeType: "text/markdown",
	buffer: Buffer.from("---\nname: project-notes\ndescription: Keep project notes.\n---\n\nKeep key facts.\n"),
};
const officialSkills = [
	{
		skill_id: "skill_official_docs",
		name: "官方文档",
		source: "official",
		status: "active",
		latest_version: "5",
		available: true,
	},
];
const agentDialog = (page: Page) => page.getByRole("region", { name: "基础配置", exact: true, includeHidden: true });
const uploadDialog = (page: Page) => page.getByRole("dialog", { name: "上传 Skill", exact: true });
const skillPicker = (page: Page) => page.getByRole("dialog", { name: /^选择 Skill(?:\s|$)/ });
const selectedSkills = (page: Page) =>
	agentDialog(page).getByRole("list", { name: "已选 Skill", exact: true, includeHidden: true });

/** 保护嵌套上传后的草稿、revision 和取消恢复；包解析及磁盘事务由 server 合同测试保护。 */
async function openTemplate(page: Page, remoteSkillCount = 1) {
	const remoteSkills = Array.from({ length: remoteSkillCount }, (_, index) => ({
		skill_id: index === 0 ? "skill_search" : `skill_custom_${index + 1}`,
		name: index === 0 ? "云端检索" : `云端技能 ${index + 1}`,
		source: "custom",
		status: "active",
		latest_version: "3",
		available: true,
	}));
	const state = {
		revision: "revision-1",
		writes: [] as string[],
		uploadRequests: [] as string[],
		uploads: [] as ProjectSkillUpload[],
		saved: [] as ProjectSkillUpload[],
		discarded: [] as string[],
		previews: [] as ProjectSkillUploadInput[],
		commits: [] as ProjectSkillUploadInput[],
		agents: [] as ProjectAgentCreateInput[],
		failNextCommit: false,
		beforeUpload: undefined as (() => Promise<void>) | undefined,
		beforeCommit: undefined as (() => Promise<void>) | undefined,
	};
	const responses: Record<string, unknown> = {
		"/api/admin/identity": { role: "admin", subject: "admin:skill-upload" },
		"/api/admin/resource-drafts/resource-draft-1/resources/resource-bindings": { resources: [] },
		"/api/admin/remote/agents": [{ agent_id: "agent_existing", name: "现有助手", version: 2 }],
		"/api/admin/preset-packs/agents/agent_existing/resources": {
			agent_id: "agent_existing",
			complete: true,
			sessions: [],
		},
		"/api/admin/remote/environments": [{ environment_id: "env_existing", name: "现有环境" }],
		"/api/admin/remote/environments/env_existing": {
			environment_id: "env_existing",
			name: "现有环境",
			configuration: { type: "cloud" },
		},
	};
	const upload = async (route: Route) => {
		const body = route.request().postDataBuffer()?.toString() ?? "";
		const filename = /filename="([^"]+)"/.exec(body)?.[1] ?? "missing";
		expect(body).toContain('name="base_revision"');
		expect(body).toContain(state.revision);
		state.uploadRequests.push(filename);
		await state.beforeUpload?.();
		const entry: ProjectSkillUpload = {
			upload_id: `upload-${state.uploads.length + 1}`,
			skill_key: filename === "guide.zip" ? "project_guide" : "project_notes",
			name: filename === "guide.zip" ? "上传指南" : "上传笔记",
			filename,
			size: 120,
			sha256: "a".repeat(64),
			file_count: filename.endsWith(".zip") ? 2 : 1,
			expanded_size: 200,
		};
		state.uploads.push(entry);
		await route.fulfill({ status: 201, json: { data: entry } });
	};
	const save = async (route: Route, preview: boolean) => {
		const input = route.request().postDataJSON() as ProjectSkillUploadInput;
		const skills = state.uploads.filter((entry) => input.upload_ids.includes(entry.upload_id));
		if (preview) {
			state.previews.push(input);
			return route.fulfill({
				json: {
					data: {
						base_revision: state.revision,
						before: "",
						after: JSON.stringify(skills),
						diagnostics: [],
						can_commit: true,
						skill_uploads: skills,
					},
				},
			});
		}
		state.commits.push(input);
		await state.beforeCommit?.();
		if (state.failNextCommit) {
			state.failNextCommit = false;
			return route.fulfill({
				status: 500,
				json: { error: { code: "internal", message: "本地 Skill 保存失败，请重试" } },
			});
		}
		state.saved.push(...skills);
		state.revision = "revision-2";
		return route.fulfill({ json: { data: { new_revision: state.revision, skills } } });
	};
	const read = (path: string, source: string | null) => {
		if (path === `${projectPath}/declarations/agent/local_agent`)
			return {
				base_revision: "revision-3",
				source_path: "agents/local_agent/agent.json",
				declaration: state.agents.at(-1),
			};
		if (path === "/api/admin/remote/skills") return source === "custom" ? remoteSkills : officialSkills;
		if (path === projectPath)
			return {
				name: "resource-draft-1",
				project_revision: state.revision,
				aligned: false,
				remote_checked: false,
				drift: [],
				agents: [],
				environments: [],
			};
		if (path === `${projectPath}/agent-options`)
			return {
				base_revision: state.revision,
				skills: state.saved.map((entry) => ({ id: entry.skill_key, name: entry.name })),
				mcp_servers: [{ name: "browser-tools" }],
			};
		return responses[path] ?? [];
	};
	const drafts = resourceDraftFixture();
	await page.route(`${apiBase}/api/**`, async (route) => {
		const request = route.request();
		const requestUrl = new URL(request.url());
		const path = requestUrl.pathname.replace(/^\/kit/, "");
		if (path.endsWith("/config")) {
			return route.fulfill({ json: { data: { apiBaseUrl: apiBase, protocolVersion: PROTOCOL_VERSION } } });
		}
		expect(request.headers().authorization).toBe(`Bearer ${ADMIN_TOKEN}`);

		if (request.method() === "GET")
			return route.fulfill({ json: { data: read(path, requestUrl.searchParams.get("source")) } });
		const operation = `${request.method()} ${path}`;
		state.writes.push(operation);
		if (operation === `POST ${uploadPath}`) return upload(route);
		if (request.method() === "DELETE" && path.startsWith(`${uploadPath}/upload-`)) {
			state.discarded.push(path.split("/").at(-1) ?? "");
			return route.fulfill({ json: { data: { deleted: true } } });
		}
		if ([`POST ${uploadPath}/preview`, `POST ${uploadPath}/commit`].includes(operation))
			return save(route, path.endsWith("/preview"));
		if (operation === `POST ${projectPath}/agents`) {
			state.agents.push(request.postDataJSON());
			state.revision = "revision-3";
			return route.fulfill({
				status: 201,
				json: {
					data: {
						new_revision: "revision-3",
						agent: { id: "local_agent", name: "本地助手", source_path: "agents/local_agent/agent.json" },
					},
				},
			});
		}
		return route.fulfill({
			status: 500,
			json: { error: { code: "internal", message: "仅允许本地 Skill 和 Agent 保存" } },
		});
	});
	await installResourceDraftFixture(page, apiBase, drafts);
	await installTemplateAgentDetailFixture(page, apiBase);
	const preparation = await installAgentPublishReviewFixture(page, apiBase, projectPath, () => state.revision);
	const url = new URL(process.env.KIT_E2E_CONSOLE_URL ?? "http://localhost:5174/");
	url.searchParams.set("api", apiBase);
	await page.goto(url.href);
	await page.getByPlaceholder("ADMIN_TOKEN").fill(ADMIN_TOKEN);
	await page.getByRole("button", { name: "进入", exact: true }).click();
	await openConsoleNavigation(page);
	await page.getByTestId("template-create-tab").click();
	await page.getByRole("button", { name: "从零开始创建", exact: true }).click();
	await page
		.getByRole("region", { name: "展示配置", exact: true })
		.getByRole("textbox", { name: "智能体名称", exact: true })
		.fill("保留模版草稿");
	await openTemplateAgentPicker(page);
	await page.getByRole("button", { name: "选择智能体 现有助手（agent_existing）", exact: true }).click();
	await confirmTemplateAgentSelection(page);
	await selectInlineEnvironment(page, "选择环境 现有环境（env_existing）");

	const dialog = agentDialog(page);
	await dialog.getByRole("textbox", { name: "智能体名称", exact: true }).fill("本地助手");
	const model = dialog.getByRole("combobox", { name: "模型", exact: true });
	await model.fill("AUTO");
	await model.press("Enter");
	await expect(
		dialog.getByRole("region", { name: "模型", exact: true }).getByTitle("AUTO", { exact: true }),
	).toBeVisible();
	await dialog.getByRole("textbox", { name: "智能体描述", exact: true }).fill("保留智能体描述");
	await dialog.getByRole("textbox", { name: "系统提示词", exact: true }).fill("保留系统提示词");
	return Object.assign(state, { drafts, preparation });
}

const next = (page: Page) => page.getByRole("button", { name: "下一步：预览调试", exact: true, includeHidden: true });
async function prepareForReview(page: Page) {
	await next(page).click();
	const review = page.getByRole("dialog", { name: "确认发布", exact: true });
	await expect(review).toBeVisible();
	await review.getByRole("button", { name: "取消", exact: true }).click();
}

async function dropFiles(page: Page, filenames: string[]) {
	const transfer = await page.evaluateHandle((names) => {
		const data = new DataTransfer();
		for (const name of names) data.items.add(new File(["fixture payload"], name, { type: "application/zip" }));
		return data;
	}, filenames);
	try {
		await uploadDialog(page).getByRole("button", { name: "选择 Skill 文件", exact: true }).dispatchEvent("drop", {
			dataTransfer: transfer,
		});
	} finally {
		await transfer.dispose();
	}
}

const skillInput = (page: Page) => uploadDialog(page).locator('input[type="file"]');

test("仅上传 Skill 后取消智能体：退出仍需确认，取消保留并可继续选用", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const state = await openTemplate(page);
	await agentDialog(page).getByRole("button", { name: "上传 Skill", exact: true }).click();
	await skillInput(page).setInputFiles(notesFile);
	await uploadDialog(page).getByRole("button", { name: "确认", exact: true }).click();
	await expect(uploadDialog(page)).toHaveCount(0);
	await agentDialog(page).getByRole("button", { name: "清空", exact: true }).click();
	expect(state.agents).toEqual([]);
	expect(state.commits).toHaveLength(1);
	await openConsoleNavigation(page);
	await page.getByTestId("template-list-tab").click();
	const exit = page.getByRole("alertdialog", { name: "确认退出", exact: true });
	await expect(exit.getByText("退出后未发布的内容将被清空，是否确认退出？", { exact: true })).toBeVisible();
	await expect(exit.getByRole("button", { name: "确认退出", exact: true })).toBeInViewport();
	await exit.getByRole("button", { name: "取消", exact: true }).click();
	await expect(exit).toHaveCount(0);
	expect(state.drafts.discarded).toEqual([]);

	await agentDialog(page).getByRole("button", { name: "添加 Skill", exact: true }).click();
	await skillPicker(page).getByRole("button", { name: "我的 Skill", exact: true }).click();
	await expect(
		skillPicker(page).getByRole("button", { name: "选择 Skill 上传笔记（project_notes）", exact: true }),
	).toBeVisible();
	await skillPicker(page).getByRole("button", { name: "完成", exact: true }).click();
	await agentDialog(page).getByRole("button", { name: "清空", exact: true }).click();
	await openConsoleNavigation(page);
	await page.getByTestId("template-list-tab").click();
	await exit.getByRole("button", { name: "确认退出", exact: true }).click();
	await expect.poll(() => state.drafts.discarded).toEqual(["resource-draft-1"]);
});

test("智能体上传 Skill：确认后自动添加且保留旧选择，并用新 revision 创建", async ({ page }, testInfo) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const state = await openTemplate(page);
	const dialog = agentDialog(page);
	await dialog.getByRole("button", { name: "添加 Skill", exact: true }).click();
	await skillPicker(page).getByRole("button", { name: "我的 Skill", exact: true }).click();
	await skillPicker(page).getByRole("button", { name: "选择 Skill 云端检索（skill_search）", exact: true }).click();
	await skillPicker(page).getByRole("button", { name: "完成", exact: true }).click();
	await dialog.getByRole("button", { name: "添加 MCP", exact: true }).click();
	await dialog.getByRole("textbox", { name: "服务标识", exact: true }).fill("browser-tools");
	const opener = dialog.getByRole("button", { name: "上传 Skill", exact: true });
	await opener.click();
	const upload = uploadDialog(page);
	const input = skillInput(page);
	const choose = upload.getByRole("button", { name: "选择 Skill 文件", exact: true });
	const selected = upload.getByRole("list", { name: "待保存 Skill", exact: true });
	const confirm = upload.getByRole("button", { name: /确认$/ });
	await expect(input).not.toHaveAttribute("multiple");
	await expect(input).toHaveAttribute("accept", /zip/);
	await expect(input).toHaveAttribute("accept", /md/);
	await expect(confirm).toBeDisabled();
	await expect(choose).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath("skill-upload-desktop-empty.png") });
	const clickChoice = page.waitForEvent("filechooser");
	await choose.click();
	await (await clickChoice).setFiles(notesFile);
	await expect(selected).toContainText("SKILL.md");
	await expect(choose).toHaveCount(0);
	await upload.getByRole("button", { name: "移除 SKILL.md", exact: true }).click();
	await expect(choose).toBeVisible();
	const keyboardChoice = page.waitForEvent("filechooser");
	await choose.focus();
	await page.keyboard.press("Enter");
	await (await keyboardChoice).setFiles(guidePackage);
	await expect(selected).toContainText("guide.zip");
	await expect(choose).toHaveCount(0);
	await upload.getByRole("button", { name: "移除 guide.zip", exact: true }).click();
	await dropFiles(page, ["first.zip", "second.zip"]);
	await expect(upload.getByRole("alert")).toContainText(/只能选择一个|仅支持.*一个/);
	await expect(selected.getByRole("listitem")).toHaveCount(0);
	await expect(confirm).toBeDisabled();
	await input.setInputFiles({ name: "README.md", mimeType: "text/markdown", buffer: Buffer.from("invalid name") });
	await expect(upload.getByRole("alert")).toContainText(/ZIP.*SKILL\.md|SKILL\.md.*ZIP/);
	await expect(selected.getByRole("listitem")).toHaveCount(0);
	await expect(confirm).toBeDisabled();
	await dropFiles(page, ["guide.zip"]);
	await expect(selected.getByRole("listitem")).toHaveCount(1);
	await expect(selected).toContainText("guide.zip");
	await expect(choose).toHaveCount(0);
	await expect(upload.getByRole("alert")).toHaveCount(0);
	await expect(confirm).toBeEnabled();
	await page.screenshot({ path: testInfo.outputPath("skill-upload-desktop-selected.png") });
	expect(state.writes).toEqual([]);
	const gate = Promise.withResolvers<void>();
	state.beforeCommit = () => gate.promise;
	await confirm.click();
	try {
		await expect.poll(() => state.commits.length).toBe(1);
		await expect(confirm).toBeDisabled();
		await expect(upload.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
		await expect(upload.getByRole("button", { name: "移除 guide.zip", exact: true })).toBeDisabled();
		await expect(dialog.getByRole("textbox", { name: "智能体名称", exact: true, includeHidden: true })).toBeDisabled();
		await expect(dialog.getByRole("button", { name: "清空", exact: true, includeHidden: true })).toBeDisabled();
		await expect(page.getByTestId("template-list-tab")).toBeDisabled();
		await expect(
			page
				.locator('footer[aria-label="模版配置操作"]')
				.getByRole("button", { name: /^(下一步：预览调试|保存智能体|保存修改)$/, includeHidden: true }),
		).toBeDisabled();
		await page.keyboard.press("Enter");
		await page.keyboard.press("Escape");
		await expect(upload).toBeVisible();
	} finally {
		gate.resolve();
	}
	await expect(upload).toHaveCount(0);
	await expect(dialog.getByRole("status")).toContainText("已保存并添加 1 个 Skill。");
	await expect(opener).toBeFocused();
	await expect(dialog.getByRole("textbox", { name: "智能体名称", exact: true })).toHaveValue("本地助手");
	await expect(dialog.getByRole("textbox", { name: "智能体描述", exact: true })).toHaveValue("保留智能体描述");
	await expect(dialog.getByRole("textbox", { name: "系统提示词", exact: true })).toHaveValue("保留系统提示词");
	await expect(
		dialog.getByRole("region", { name: "模型", exact: true }).getByTitle("AUTO", { exact: true }),
	).toBeVisible();
	await expect(selectedSkills(page)).toContainText("云端检索");
	await expect(selectedSkills(page)).toContainText("上传指南");
	await expect(selectedSkills(page).getByRole("listitem")).toHaveCount(2);
	await expect(dialog.getByRole("textbox", { name: "服务标识", exact: true })).toHaveValue("browser-tools");
	await dialog.getByRole("button", { name: "添加 Skill", exact: true }).click();
	await expect(
		skillPicker(page).getByRole("group", { name: "Skill 来源", exact: true }).getByRole("button"),
	).toHaveText(["我的 Skill", "官方 Skill"]);
	await expect(
		skillPicker(page).getByRole("button", { name: "选择 Skill 云端检索（skill_search）", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	const localSkill = skillPicker(page).getByRole("button", {
		name: "选择 Skill 上传指南（project_guide）",
		exact: true,
	});
	await expect(localSkill).toHaveAttribute("aria-pressed", "true");
	await expect(localSkill).toContainText("本地 Skill");
	const choices = skillPicker(page).getByRole("list", { name: "Skill 列表", exact: true });
	await expect(choices.getByRole("button").first()).toHaveAccessibleName("选择 Skill 上传指南（project_guide）");
	await skillPicker(page).getByRole("searchbox", { name: "搜索 Skill", exact: true }).fill("上传指南");
	await expect(choices.getByRole("button")).toHaveCount(1);
	await localSkill.click();
	await expect(localSkill).toHaveAttribute("aria-pressed", "false");
	await expect(skillPicker(page).getByRole("status")).toContainText("已选择 1 个 Skill");
	await localSkill.click();
	await expect(localSkill).toHaveAttribute("aria-pressed", "true");
	await skillPicker(page).getByRole("searchbox", { name: "搜索 Skill", exact: true }).fill("");
	await skillPicker(page).getByRole("button", { name: "官方 Skill", exact: true }).click();
	await expect(
		skillPicker(page).getByRole("button", { name: "选择 Skill 官方文档（skill_official_docs）", exact: true }),
	).toBeVisible();
	await expect(localSkill).toHaveCount(0);
	await expect(skillPicker(page).getByRole("status")).toContainText("已选择 2 个 Skill");
	await skillPicker(page).getByRole("button", { name: "我的 Skill", exact: true }).click();
	await expect(localSkill).toHaveAttribute("aria-pressed", "true");
	await skillPicker(page).getByRole("button", { name: "完成", exact: true }).click();
	await expect(selectedSkills(page)).toContainText("上传指南");
	await expect(selectedSkills(page).getByRole("listitem")).toHaveCount(2);
	await prepareForReview(page);
	await expect.poll(() => state.agents.length).toBe(1);
	expect(state.agents).toMatchObject([
		{
			base_revision: "revision-2",
			name: "本地助手",
			model: "auto",
			description: "保留智能体描述",
			instructions: "保留系统提示词",
			skills: [{ type: "custom", skill_id: "skill_search", version: "3" }, "project_guide"],
			mcp_servers: ["browser-tools"],
		},
	]);
	expect(state.uploadRequests).toEqual(["guide.zip"]);
	expect(state.previews).toEqual([{ base_revision: "revision-1", upload_ids: ["upload-1"] }]);
	expect(state.commits).toEqual(state.previews);
	expect(state.discarded).toEqual([]);
	expect(state.writes).toEqual([
		`POST ${uploadPath}`,
		`POST ${uploadPath}/preview`,
		`POST ${uploadPath}/commit`,
		`POST ${projectPath}/agents`,
	]);
	const summary = page.getByRole("region", { name: "已选配置预览", exact: true });
	await expect(summary).toContainText("保留模版草稿");
	await expect(dialog.getByRole("textbox", { name: "智能体名称", exact: true })).toHaveValue("本地助手");
	await expect(summary).toContainText("env_existing");
	await openTemplateAgentPicker(page);
	await expect(page.getByRole("button", { name: /^选择智能体 本地助手（local:/ })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await closeTemplateAgentPicker(page);
	await dialog.getByRole("button", { name: "清空", exact: true }).click();
	await dialog.getByRole("button", { name: "添加 Skill", exact: true }).click();
	await expect(localSkill).toHaveAttribute("aria-pressed", "false");
	await localSkill.click();
	await skillPicker(page).getByRole("button", { name: "完成", exact: true }).click();
	await expect(selectedSkills(page)).toContainText("上传指南");
	await expect(selectedSkills(page).getByRole("listitem")).toHaveCount(1);
	await dialog.getByRole("button", { name: "清空", exact: true }).click();
	expect(state.commits).toHaveLength(1);
	expect(state.agents).toHaveLength(1);
	expect(state.drafts.created).toBe(1);
	expect(state.writes.every((write) => write.includes("/resource-drafts/resource-draft-1/resources/"))).toBe(true);
});

test("智能体上传 Skill：窄屏保存全程锁定，失败复用暂存，未提交取消零写入并清理失败暂存", async ({ page }, testInfo) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const state = await openTemplate(page);
	const dialog = agentDialog(page);
	const opener = dialog.getByRole("button", { name: "上传 Skill", exact: true });
	await opener.click();
	const upload = uploadDialog(page);
	const input = skillInput(page);
	const selected = upload.getByRole("list", { name: "待保存 Skill", exact: true });
	const confirm = upload.getByRole("button", { name: /确认$/ });
	await expect(upload.getByRole("button", { name: "选择 Skill 文件", exact: true })).toBeInViewport();
	await expect(confirm).toBeInViewport();
	await page.screenshot({ path: testInfo.outputPath("skill-upload-mobile-empty.png") });
	await input.setInputFiles(notesFile);
	await expect(selected).toContainText("SKILL.md");
	await expect(confirm).toBeEnabled();
	await expect(confirm).toBeInViewport();
	await page.screenshot({ path: testInfo.outputPath("skill-upload-mobile-selected.png") });
	await upload.getByRole("button", { name: "取消", exact: true }).click();
	await expect(upload).toHaveCount(0);
	await expect(opener).toBeFocused();
	await expect(selectedSkills(page)).toHaveCount(0);
	expect(state.writes).toEqual([]);
	await opener.click();
	await expect(selected.getByRole("listitem")).toHaveCount(0);
	await expect(confirm).toBeDisabled();
	await input.setInputFiles(notesFile);
	const gate = Promise.withResolvers<void>();
	state.beforeUpload = () => gate.promise;
	state.failNextCommit = true;
	await confirm.click();
	try {
		await expect.poll(() => state.uploadRequests.length).toBe(1);
		await expect(confirm).toBeDisabled();
		await expect(upload.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
		await expect(upload.getByRole("button", { name: "关闭上传 Skill", exact: true })).toBeDisabled();
		await expect(upload.getByRole("button", { name: "移除 SKILL.md", exact: true })).toBeDisabled();
		await expect(dialog.getByRole("textbox", { name: "智能体名称", exact: true, includeHidden: true })).toBeDisabled();
		await expect(dialog.getByRole("button", { name: "清空", exact: true, includeHidden: true })).toBeDisabled();
		await expect(
			page
				.locator('footer[aria-label="模版配置操作"]')
				.getByRole("button", { name: /^(下一步：预览调试|保存智能体|保存修改)$/, includeHidden: true }),
		).toBeDisabled();
		await page.keyboard.press("Escape");
		await expect(upload).toBeVisible();
	} finally {
		gate.resolve();
	}
	await expect(upload.getByRole("alert")).toContainText("本地 Skill 保存失败，请重试");
	await expect(selectedSkills(page)).toHaveCount(0);
	await expect(selected).toContainText("SKILL.md");
	await expect(confirm).toBeEnabled();
	await expect(confirm).toBeInViewport();
	await expect(upload.getByRole("button", { name: "取消", exact: true })).toBeInViewport();
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	let overviewAttempts = 0;
	await page.route(`${apiBase}${projectPath}`, async (route) => {
		overviewAttempts += 1;
		if (overviewAttempts > 1) return route.fallback();
		return route.fulfill({ status: 500, json: { error: { code: "internal", message: "项目刷新失败，请重试" } } });
	});
	await confirm.click();
	await expect(upload).toHaveCount(0);
	await expect(dialog.getByRole("alert")).toContainText("项目刷新失败，请重试");
	await expect(selectedSkills(page)).toContainText("上传笔记");
	await expect(selectedSkills(page).getByRole("listitem")).toHaveCount(1);
	await dialog.getByRole("button", { name: "重试", exact: true }).click();
	await expect(dialog.getByRole("alert")).toHaveCount(0);
	await expect(next(page)).toBeEnabled();
	await expect(selectedSkills(page).getByRole("listitem")).toHaveCount(1);
	expect(state.uploadRequests).toEqual(["SKILL.md"]);
	expect(state.commits).toEqual([
		{ base_revision: "revision-1", upload_ids: ["upload-1"] },
		{ base_revision: "revision-1", upload_ids: ["upload-1"] },
	]);
	await opener.click();
	await input.setInputFiles(guidePackage);
	state.failNextCommit = true;
	await confirm.click();
	await expect(upload.getByRole("alert")).toContainText("本地 Skill 保存失败，请重试");
	await expect(selectedSkills(page).getByRole("listitem", { includeHidden: true })).toHaveCount(1);
	await expect(selectedSkills(page)).not.toContainText("上传指南");
	await upload.getByRole("button", { name: "移除 guide.zip", exact: true }).click();
	await expect.poll(() => state.discarded).toEqual(["upload-2"]);
	await expect(selected.getByRole("listitem")).toHaveCount(0);
	await expect(confirm).toBeDisabled();
	await expect(upload.getByRole("button", { name: "选择 Skill 文件", exact: true })).toBeVisible();
	await input.setInputFiles(guidePackage);
	state.failNextCommit = true;
	await confirm.click();
	await expect.poll(() => state.commits.length).toBe(4);
	await expect(confirm).toBeEnabled();
	await page.keyboard.press("Escape");
	await expect(upload).toHaveCount(0);
	await expect(opener).toBeFocused();
	await expect.poll(() => state.discarded).toEqual(["upload-2", "upload-3"]);
	await expect(dialog).toBeVisible();
	await expect(selectedSkills(page).getByRole("listitem")).toHaveCount(1);
	await expect(selectedSkills(page)).toContainText("上传笔记");
	expect(state.uploadRequests).toEqual(["SKILL.md", "guide.zip", "guide.zip"]);
	expect(state.agents).toEqual([]);
	await expect(dialog.getByRole("textbox", { name: "智能体名称", exact: true })).toHaveValue("本地助手");
	await expect(dialog.getByRole("textbox", { name: "系统提示词", exact: true })).toHaveValue("保留系统提示词");
	await opener.click();
	await expect(selected.getByRole("listitem")).toHaveCount(0);
	await expect(upload.getByRole("alert")).toHaveCount(0);
	await expect(confirm).toBeDisabled();
	await upload.getByRole("button", { name: "取消", exact: true }).click();
	await expect(opener).toBeFocused();
	expect(state.writes.every((entry) => entry.includes(uploadPath))).toBe(true);
});

test("智能体上传 Skill：已有 9 项上传后自动补足 10 项，移除后恢复上传入口", async ({ page }) => {
	const state = await openTemplate(page, 9);
	const dialog = agentDialog(page);
	await dialog.getByRole("button", { name: "添加 Skill", exact: true }).click();
	await skillPicker(page).getByRole("button", { name: "我的 Skill", exact: true }).click();
	const options = skillPicker(page).getByRole("list", { name: "Skill 列表", exact: true }).getByRole("button");
	await expect(options).toHaveCount(9);
	for (const option of await options.all()) await option.click();
	await skillPicker(page).getByRole("button", { name: "完成", exact: true }).click();
	await expect(selectedSkills(page).getByRole("listitem")).toHaveCount(9);
	const opener = dialog.getByRole("button", { name: "上传 Skill", exact: true });
	await opener.click();
	await skillInput(page).setInputFiles(notesFile);
	await uploadDialog(page).getByRole("button", { name: "确认", exact: true }).click();
	await expect(uploadDialog(page)).toHaveCount(0);
	await expect(selectedSkills(page).getByRole("listitem")).toHaveCount(10);
	await expect(selectedSkills(page)).toContainText("云端检索");
	for (let index = 2; index <= 9; index += 1) await expect(selectedSkills(page)).toContainText(`云端技能 ${index}`);
	await expect(selectedSkills(page)).toContainText("上传笔记");
	await expect(opener).toBeDisabled();
	await expect(dialog.getByText("最多选择 10 个 Skill，请先移除一个再上传。", { exact: true })).toBeVisible();
	await expect(dialog.getByRole("textbox", { name: "智能体名称", exact: true })).toBeFocused();
	await dialog.getByRole("button", { name: "移除 Skill 云端检索", exact: true }).click();
	await expect(selectedSkills(page).getByRole("listitem")).toHaveCount(9);
	await expect(selectedSkills(page)).toContainText("上传笔记");
	await expect(opener).toBeEnabled();
	await opener.click();
	await uploadDialog(page).getByRole("button", { name: "取消", exact: true }).click();
	await expect(opener).toBeFocused();
	expect(state.uploadRequests).toEqual(["SKILL.md"]);
	expect(state.commits).toEqual([{ base_revision: "revision-1", upload_ids: ["upload-1"] }]);
	expect(state.writes).toEqual([`POST ${uploadPath}`, `POST ${uploadPath}/preview`, `POST ${uploadPath}/commit`]);
});

test("我的 Skill：本地与云端分别失败可独立恢复，过期本地配置重新加载后可选", async ({ page }) => {
	const state = await openTemplate(page);
	state.saved.push({
		upload_id: "persisted-upload",
		skill_key: "skill_search",
		name: "持久本地技能",
		filename: "SKILL.md",
		size: 120,
		sha256: "a".repeat(64),
		file_count: 1,
		expanded_size: 120,
	});
	const dialog = agentDialog(page);
	const picker = skillPicker(page);
	const open = dialog.getByRole("button", { name: "添加 Skill", exact: true });
	const local = picker.getByRole("button", { name: "选择 Skill 持久本地技能（skill_search）", exact: true });
	const remote = picker.getByRole("button", { name: "选择 Skill 云端检索（skill_search）", exact: true });
	await open.click();
	await expect(local).toBeEnabled();
	await expect(remote).toBeEnabled();
	await expect(picker.getByRole("list", { name: "Skill 列表", exact: true }).getByRole("listitem")).toHaveCount(2);
	await picker.getByRole("button", { name: "完成", exact: true }).click();
	let failRemote = true;
	let failLocal = false;
	await page.route(`${apiBase}/api/admin/remote/skills?source=custom`, async (route) => {
		if (!failRemote) return route.fallback();
		return route.fulfill({ status: 500, json: { error: { code: "internal", message: "云端 Skill 查询失败" } } });
	});
	await page.route(`${apiBase}${projectPath}/agent-options`, async (route) => {
		if (!failLocal) return route.fallback();
		return route.fulfill({ status: 500, json: { error: { code: "internal", message: "本地 Skill 查询失败" } } });
	});
	await open.click();
	await expect(picker.getByRole("alert")).toContainText("云端 Skill 查询失败");
	await expect(local).toBeEnabled();
	await local.click();
	await expect(local).toHaveAttribute("aria-pressed", "true");
	failRemote = false;
	await picker.getByRole("button", { name: "重试", exact: true }).click();
	await expect(picker.getByRole("alert")).toHaveCount(0);
	await expect(remote).toBeEnabled();
	await expect(local).toHaveAttribute("aria-pressed", "true");
	await picker.getByRole("button", { name: "完成", exact: true }).click();
	failLocal = true;
	await open.click();
	await expect(picker.getByRole("alert")).toContainText("本地 Skill 查询失败");
	await expect(remote).toBeEnabled();
	await remote.click();
	await expect(remote).toHaveAttribute("aria-pressed", "true");
	failLocal = false;
	await picker.getByRole("button", { name: "重试", exact: true }).click();
	await expect(picker.getByRole("alert")).toHaveCount(0);
	await expect(local).toHaveAttribute("aria-pressed", "true");
	await local.click();
	await picker.getByRole("button", { name: "完成", exact: true }).click();
	state.revision = "revision-2";
	await open.click();
	await expect(picker.getByRole("alert")).toHaveCount(0);
	await expect(local).toBeEnabled();
	await local.click();
	await picker.getByRole("button", { name: "完成", exact: true }).click();
	await expect(selectedSkills(page).getByRole("listitem")).toHaveCount(2);
	await prepareForReview(page);
	await expect.poll(() => state.agents.length).toBe(1);
	expect(state.agents).toHaveLength(1);
	expect(state.agents[0]).toMatchObject({
		base_revision: "revision-2",
		skills: [{ type: "custom", skill_id: "skill_search", version: "3" }, "skill_search"],
	});
	expect(state.writes).toEqual([`POST ${projectPath}/agents`]);
});
