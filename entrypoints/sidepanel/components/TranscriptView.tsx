import { type LiveText, LiveTranscript } from "./LiveTranscript";

interface Props {
	finalText: string;
	live: LiveText | null;
	copied: boolean;
	deliveryNotice: string | null;
	onCopy: () => void;
	onClear: () => void;
	onEdit: (text: string) => void;
}

export function TranscriptView({
	finalText,
	live,
	copied,
	deliveryNotice,
	onCopy,
	onClear,
	onEdit,
}: Props) {
	return (
		<div className="transcript">
			{deliveryNotice && <p className="delivery-notice">{deliveryNotice}</p>}
			<div className="transcript-header">
				<h3>Transcript</h3>
				<div>
					{finalText && (
						<>
							<button type="button" className="btn btn-ghost" onClick={onCopy}>
								{copied ? "Copied!" : "Copy"}
							</button>
							<button type="button" className="btn btn-ghost" onClick={onClear}>
								Clear
							</button>
						</>
					)}
				</div>
			</div>
			<textarea
				aria-label="Transcript"
				className="transcript-text"
				onChange={(event) => onEdit(event.target.value)}
				placeholder="Your dictation appears here. You can type or edit it."
				value={finalText}
			/>
			{live && <LiveTranscript {...live} />}
		</div>
	);
}
