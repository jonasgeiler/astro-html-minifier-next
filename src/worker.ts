import { parentPort } from "node:worker_threads";
import {
	type MinifierOptions as HTMLMinifierOptions,
	minify as minifyHtml,
} from "html-minifier-next";

parentPort!.once(
	"message",
	({ html, options }: { html: string; options: HTMLMinifierOptions }) => {
		try {
			const result = minifyHtml(html, options);
			parentPort!.postMessage({ result });
		} catch (error) {
			parentPort!.postMessage({ error });
		}
	},
);
