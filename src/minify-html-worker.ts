import { isMainThread, parentPort } from "node:worker_threads";
import { minifyHTMLFile } from "./minify-html-file.js";
import type {
	MinifyHTMLWorkerInput,
	MinifyHTMLWorkerOutput,
} from "./minify-html-worker-pool.js";

if (isMainThread) {
	throw new Error("Not a worker thread.");
}

// biome-ignore-start lint/style/noNonNullAssertion: I can assume `parentPort` is not null.
parentPort!.on(
	"message",
	async ({ htmlFile, minifyHTMLOptions }: MinifyHTMLWorkerInput) => {
		try {
			parentPort!.postMessage(
				(await minifyHTMLFile(
					htmlFile,
					minifyHTMLOptions,
				)) satisfies MinifyHTMLWorkerOutput,
			);
		} catch (error) {
			parentPort!.postMessage({ error } satisfies MinifyHTMLWorkerOutput);
		}
	},
);
// biome-ignore-end lint/style/noNonNullAssertion: See start.
