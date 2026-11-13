import { UploadOutlined } from "@ant-design/icons";
import {
	BRANDING_LOGO_MAX_BYTES,
	BRANDING_LOGO_PATH,
	BRANDING_LOGO_TYPES,
	type BrandingView,
} from "@openagentpack/kit-sdk/protocol";
import { Alert, Button, Input, Result, Segmented, Skeleton, Space, Typography, Upload } from "antd";
import { useEffect, useState } from "react";
import { useAdminMutation } from "../../lib/admin/use-admin-mutation.ts";
import { useAdminQuery } from "../../lib/admin/use-admin-query.ts";
import { adminApi, getAdminClient } from "../../lib/api.ts";
import { InnerLayout } from "../navigation/inner-layout.tsx";

type LogoMode = "upload" | "url";

function logoError(value: string): string | undefined {
	const logo = value.trim();
	if (!logo) return undefined;
	return (logo.startsWith("/") && !logo.startsWith("//")) || /^https?:\/\//i.test(logo)
		? undefined
		: "请输入以单个 / 开头的员工端本站路径，或 http(s) 在线地址";
}

function fileError(file: File): string | undefined {
	if (!(BRANDING_LOGO_TYPES as readonly string[]).includes(file.type)) return "仅支持 PNG、JPEG、WebP 或 SVG 图片";
	if (file.size > BRANDING_LOGO_MAX_BYTES) return `图片不能超过 ${Math.floor(BRANDING_LOGO_MAX_BYTES / 1024)}KB`;
	return undefined;
}

function BrandPreview({ productName, logoUrl }: { productName: string; logoUrl?: string }) {
	const [failed, setFailed] = useState(false);
	const name = productName.trim() || "OpenAgentPack Kit";
	return (
		<div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
			<Typography.Text type="secondary">员工端预览</Typography.Text>
			<div className="mt-3 flex items-center gap-3">
				{logoUrl && !failed ? (
					<img
						src={logoUrl}
						alt=""
						aria-hidden="true"
						className="size-10 rounded-md bg-white object-contain"
						onError={() => setFailed(true)}
					/>
				) : (
					<span
						aria-hidden="true"
						className="grid size-10 place-items-center rounded-md bg-neutral-900 text-sm font-semibold text-white"
					>
						{name.charAt(0).toUpperCase()}
					</span>
				)}
				<span className="min-w-0 break-words text-base font-semibold">{name}</span>
			</div>
		</div>
	);
}

function UploadLogoControl({
	file,
	hasLogo,
	disabled,
	error,
	onFile,
	onRemove,
}: {
	file: File | null;
	hasLogo: boolean;
	disabled: boolean;
	error?: string;
	onFile: (file: File) => void;
	onRemove: () => void;
}) {
	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-center gap-3">
				<Upload
					accept={BRANDING_LOGO_TYPES.join(",")}
					showUploadList={false}
					disabled={disabled}
					beforeUpload={(next) => {
						onFile(next);
						return false;
					}}
				>
					<Button icon={<UploadOutlined />} disabled={disabled}>
						选择图片
					</Button>
				</Upload>
				{file ? <span className="min-w-0 break-all text-xs text-neutral-500">{file.name}</span> : null}
				{hasLogo && !file ? (
					<Button type="link" danger disabled={disabled} onClick={onRemove}>
						移除当前 Logo
					</Button>
				) : null}
			</div>
			<span className="block text-xs leading-5 text-neutral-500">
				支持 PNG、JPEG、WebP、SVG，最大 {Math.floor(BRANDING_LOGO_MAX_BYTES / 1024)}KB；不选择新图片时沿用当前 Logo。
			</span>
			{error ? <span className="block text-xs text-red-600">{error}</span> : null}
		</div>
	);
}

function useLogoEditor(initialUrl: string | undefined, onDirty: () => void) {
	const [logoUrl, setLogoUrl] = useState(initialUrl ?? "");
	const [mode, setMode] = useState<LogoMode>("upload");
	const [file, setFile] = useState<File | null>(null);
	const [filePreviewUrl, setFilePreviewUrl] = useState<string>();
	const [uploadError, setUploadError] = useState<string>();
	const [removeLogo, setRemoveLogo] = useState(false);

	useEffect(() => {
		if (!file) {
			setFilePreviewUrl(undefined);
			return;
		}
		const url = URL.createObjectURL(file);
		setFilePreviewUrl(url);
		return () => URL.revokeObjectURL(url);
	}, [file]);

	const changeMode = (next: LogoMode) => {
		setMode(next);
		setFile(null);
		setUploadError(undefined);
		setRemoveLogo(false);
		onDirty();
	};
	const chooseFile = (next: File) => {
		const error = fileError(next);
		setUploadError(error);
		if (error) return;
		setFile(next);
		setRemoveLogo(false);
		onDirty();
	};
	const changeUrl = (next: string) => {
		setLogoUrl(next);
		setRemoveLogo(false);
		onDirty();
	};
	const remove = () => {
		setFile(null);
		setUploadError(undefined);
		setRemoveLogo(true);
		onDirty();
	};
	const reset = () => {
		setLogoUrl(initialUrl ?? "");
		setMode("upload");
		setFile(null);
		setUploadError(undefined);
		setRemoveLogo(false);
		onDirty();
	};
	const previewUrl = removeLogo ? undefined : (filePreviewUrl ?? (logoUrl.trim() || undefined));
	return {
		mode,
		logoUrl,
		file,
		uploadError,
		removeLogo,
		previewUrl,
		hasLogo: Boolean((logoUrl || file) && !removeLogo),
		urlError: mode === "url" ? logoError(logoUrl) : undefined,
		changeMode,
		changeUrl,
		chooseFile,
		remove,
		reset,
	};
}

function LogoFields({ editor, disabled }: { editor: ReturnType<typeof useLogoEditor>; disabled: boolean }) {
	return (
		<div className="space-y-4 rounded-lg border border-neutral-200 p-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<span className="text-sm font-medium">Logo</span>
				<Segmented<LogoMode>
					options={[
						{ label: "上传图片", value: "upload" },
						{ label: "填写 URL", value: "url" },
					]}
					value={editor.mode}
					disabled={disabled}
					onChange={editor.changeMode}
				/>
			</div>
			{editor.mode === "upload" ? (
				<UploadLogoControl
					file={editor.file}
					hasLogo={editor.hasLogo}
					disabled={disabled}
					error={editor.uploadError}
					onFile={editor.chooseFile}
					onRemove={editor.remove}
				/>
			) : (
				<div className="space-y-3">
					<label htmlFor="branding-logo-url" className="text-sm font-medium">
						Logo 地址
					</label>
					<Input
						id="branding-logo-url"
						aria-label="Logo 地址"
						value={editor.logoUrl}
						placeholder={`${BRANDING_LOGO_PATH} 或 https://cdn.example.com/logo.svg`}
						maxLength={2048}
						status={editor.urlError ? "error" : undefined}
						disabled={disabled}
						onChange={(event) => editor.changeUrl(event.target.value)}
					/>
					<span className="block text-xs leading-5 text-neutral-500">
						支持员工端本站路径（以单个 / 开头）或在线 http(s) 地址；留空回退名称首字母。
					</span>
					{editor.urlError ? <span className="block text-xs text-red-600">{editor.urlError}</span> : null}
				</div>
			)}
		</div>
	);
}

function BrandingForm({
	initial,
	canWrite,
	readOnly,
	onSaved,
	onDirty,
}: {
	initial: BrandingView;
	canWrite: boolean;
	readOnly: boolean;
	onSaved: () => void;
	onDirty: () => void;
}) {
	const [productName, setProductName] = useState(initial.productName);
	const editor = useLogoEditor(initial.logoUrl, onDirty);
	const save = useAdminMutation(async () => {
		const name = productName.trim();
		if (editor.mode === "upload") {
			if (editor.file) {
				await adminApi.branding.uploadLogo(editor.file);
				return adminApi.branding.update({ productName: name });
			}
			return adminApi.branding.update({ productName: name, ...(editor.removeLogo ? { logoUrl: null } : {}) });
		}
		return adminApi.branding.update({ productName: name, logoUrl: editor.logoUrl.trim() || null });
	});
	const nameError = productName.trim() ? undefined : "产品名称不能为空";
	const invalid = Boolean(nameError || editor.urlError || editor.uploadError);
	const disabled = !canWrite || save.pending;
	const submit = () => {
		if (!canWrite || save.pending || invalid) return;
		void save.run().then(() => onSaved());
	};
	return (
		<form
			className="max-w-2xl space-y-6"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<div className="space-y-2">
				<label htmlFor="branding-product-name" className="text-sm font-medium">
					产品名称
				</label>
				<Input
					id="branding-product-name"
					aria-label="产品名称"
					value={productName}
					maxLength={60}
					showCount
					status={nameError ? "error" : undefined}
					disabled={disabled}
					onChange={(event) => {
						setProductName(event.target.value);
						onDirty();
					}}
				/>
				{nameError ? <span className="block text-xs text-red-600">{nameError}</span> : null}
			</div>
			<LogoFields editor={editor} disabled={disabled} />
			<BrandPreview
				key={`${productName}:${editor.previewUrl ?? ""}`}
				productName={productName}
				logoUrl={editor.previewUrl}
			/>
			{readOnly ? <Alert type="info" showIcon title="当前身份只读，不能修改品牌配置。" /> : null}
			{save.error ? <Alert type="error" showIcon title="保存失败" description={save.error} /> : null}
			<Space className="pt-1">
				<Button type="primary" htmlType="submit" loading={save.pending} disabled={!canWrite || invalid}>
					保存
				</Button>
				<Button
					disabled={disabled}
					onClick={() => {
						setProductName(initial.productName);
						editor.reset();
					}}
				>
					重置
				</Button>
			</Space>
		</form>
	);
}

/** 管理端维护员工端名称与 Logo；默认上传，也可切换为 URL。保存后员工端刷新 /api/config 生效。 */
export function BrandingPage() {
	const query = useAdminQuery("branding:config", (signal) => adminApi.branding.get(signal));
	const identity = useAdminQuery("branding:identity", (signal) => getAdminClient().identity(signal));
	const [saved, setSaved] = useState(false);
	if (query.error)
		return (
			<Result
				status="error"
				title="品牌配置加载失败"
				subTitle={query.error}
				extra={
					<Button aria-label="重试" onClick={() => void query.refresh()}>
						重试
					</Button>
				}
			/>
		);
	if (!query.data) return <Skeleton active paragraph={{ rows: 5 }} />;
	return (
		<section aria-label="品牌配置" className="space-y-6">
			<InnerLayout
				title="品牌配置"
				description="配置员工端左侧导航顶部的产品名称与 Logo。默认上传图片，也可切换为填写 URL。保存后员工端下次加载配置时生效。"
			/>
			{saved ? <Alert type="success" showIcon title="已保存，员工端刷新后生效。" /> : null}
			<BrandingForm
				key={`${query.data.updatedAt}:${query.data.productName}:${query.data.logoUrl ?? ""}`}
				initial={query.data}
				canWrite={identity.data?.role === "admin"}
				readOnly={identity.data?.role === "auditor"}
				onDirty={() => setSaved(false)}
				onSaved={() => {
					setSaved(true);
					void query.refresh();
				}}
			/>
		</section>
	);
}
