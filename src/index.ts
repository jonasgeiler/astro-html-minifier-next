import { readFile, writeFile } from "node:fs/promises";
import { availableParallelism as getAvailableParallelism } from "node:os";
import { relative as getRelativePath } from "node:path";
import { fileURLToPath } from "node:url";
import { styleText } from "node:util";
import type { AstroIntegration } from "astro";
import {
	type MinifierOptions as HTMLMinifierOptions,
	minify as minifyHtml,
} from "html-minifier-next";

export default function htmlMinifier(
	options: HTMLMinifierOptions,
): AstroIntegration {
	// API Reference: https://docs.astro.build/en/reference/integrations-reference/
	return {
		name: "astro-html-minifier-next",
		hooks: {
			"astro:build:done": async ({ logger, dir: distUrl, assets }) => {
				logger.info(styleText(["bgGreen", "black"], " minifying html assets "));

				const totalTimeStart = performance.now(); // --- TIMED BLOCK START ---

				// TODO: Use workers?
				const tasks: (() => Promise<void>)[] = [];
				const controller = new AbortController();
				const signal = controller.signal;
				const distPath = fileURLToPath(distUrl);
				const logLineArrow = styleText("green", "▶");
				for (const assetUrls of assets.values()) {
					for (const assetUrl of assetUrls) {
						const assetPath = fileURLToPath(assetUrl);
						if (!assetPath.toLowerCase().endsWith(".html")) {
							continue;
						}

						const relativeAssetPath = getRelativePath(distPath, assetPath);
						const logLineAssetPath = `  ${logLineArrow} /${relativeAssetPath} `;
						tasks.push(async () => {
							const timeStart = performance.now(); // --- TIMED BLOCK START ---

							const html = await readFile(assetPath, {
								encoding: "utf8",
								signal,
							});
							const minifiedHtml = await minifyHtml(html, options);

							const htmlSize = Buffer.byteLength(html);
							const minifiedHtmlSize = Buffer.byteLength(minifiedHtml);
							if (minifiedHtmlSize >= htmlSize) {
								// No actual file size savings, so we skip writing the file or logging anything.
								return;
							}

							await writeFile(assetPath, minifiedHtml, {
								encoding: "utf8",
								signal,
							});

							const timeEnd = performance.now(); // --- TIMED BLOCK END ---

							// Log a nice summary of the minification savings and the time it took.
							const savings = htmlSize - minifiedHtmlSize;
							const savingsStr =
								savings < 1000
									? `${savings}B`
									: savings < 1000000
										? `${(savings / 1000).toFixed(1)}kB`
										: `${(savings / 1000000).toFixed(2)}MB`;
							const time = timeEnd - timeStart;
							const timeStr =
								time < 1000
									? `${Math.round(time)}ms`
									: `${(time / 1000).toFixed(2)}s`;
							logger.info(
								logLineAssetPath +
									styleText("dim", `(-${savingsStr}) (+${timeStr})`),
							);
						});
					}
				}

				// We retrieve the available parallelism from the OS, even if we don't actually run the tasks in different threads.
				// It's just used as an indicator of machine capabilities and usually a good value for batching.
				const maxExecutingTasksSize = getAvailableParallelism();

				// This holds the current batch of promises that are waiting to fulfill.
				const executingTasks = new Set<Promise<void>>();

				// Batch the tasks to avoid minifying too many files at once, which could lead to memory and performance issues.
				for (const task of tasks) {
					const taskPromise = task()
						.then(() => {
							executingTasks.delete(taskPromise);
						})
						.catch((e) => {
							if (!signal.aborted) {
								controller.abort(e);
							}
							throw e;
						});

					executingTasks.add(taskPromise);

					if (executingTasks.size >= maxExecutingTasksSize) {
						// If the amount of executing tasks reaches the limit, we wait until the one of them finishes,
						// and therefore gets deleted from the list, before continuing with the next task.
						await Promise.race(executingTasks);
					}

					if (signal.aborted) {
						throw signal.reason;
					}
				}

				// Wait for any remaining tasks to finish.
				await Promise.all(executingTasks);

				const totalTimeEnd = performance.now(); // --- TIMED BLOCK END ---

				// Log how long processing all assets took.
				const totalTime = totalTimeEnd - totalTimeStart;
				const totalTimeStr =
					totalTime < 1000
						? `${Math.round(totalTime)}ms`
						: `${(totalTime / 1000).toFixed(2)}s`;
				logger.info(styleText("green", `✓ Completed in ${totalTimeStr}.`));
			},
		},
	};
}
