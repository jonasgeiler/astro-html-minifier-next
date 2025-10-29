import {
	parentPort,
	isMainThread,
} from "node:worker_threads";
import { minify as minifyHtml } from "html-minifier-next";
import type { MinifierOptions as HtmlMinifierNextOptions } from "html-minifier-next";

if (isMainThread) {
	throw new Error("This file is meant to be run as a worker thread.");
}

parentPort!.on(
	"message",
	async ({ html, minifyHtmlOptions }: { html: string; minifyHtmlOptions: HtmlMinifierNextOptions }) => {
		try {
			const result = await minifyHtml(html, minifyHtmlOptions);
			parentPort!.postMessage({ result });
		} catch (error) {
			parentPort!.postMessage({ error });
		}
	},
);
