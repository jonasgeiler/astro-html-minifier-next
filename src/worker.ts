import {
	parentPort,
	isMainThread,
} from "node:worker_threads";
import type { MinifierOptions as MinifyHtmlOptions } from "html-minifier-next";
import minifyHtmlFile from "./workerfunc.js";

if (isMainThread) {
	throw new Error("This file is meant to be run as a worker thread.");
}

parentPort!.on(
	"message",
	async ({ htmlFile, options }: { htmlFile: string; options: MinifyHtmlOptions }) => {
		try {
			const result = await minifyHtmlFile(htmlFile, options);
			parentPort!.postMessage({ result });
		} catch (error) {
			parentPort!.postMessage({ error });
		}
	},
);
