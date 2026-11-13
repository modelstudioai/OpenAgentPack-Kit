import { FileCard } from "../file-card/index.tsx";

export function ArtifactCard({
	filename,
	contentType,
	onOpen,
	onDownload,
}: {
	filename: string;
	contentType?: string;
	onOpen?: () => void;
	onDownload?: () => void;
}) {
	return <FileCard name={filename} type={contentType} onClick={onOpen} onDownload={onDownload} className="my-2" />;
}
