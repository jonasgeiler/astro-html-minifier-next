import { availableParallelism as getAvailableParallelism } from "node:os";
import { relative as getRelativePath } from "node:path";
import { fileURLToPath } from "node:url";
import { styleText } from "node:util";
import type { AstroIntegration } from "astro";
import type { MinifierOptions as MinifyHTMLOptions } from "html-minifier-next";
import { minifyHTMLFile } from "./minify-html-file.js";
import { MinifyHTMLWorkerPool } from "./minify-html-worker-pool.js";

export interface HTMLMinifierOptions extends MinifyHTMLOptions {
	/**
	 * Option specific to `astro-html-minifier-next` used to specify the maximum
	 * number of worker threads to spawn when minifying files.
	 * When set to `0`, `astro-html-minifier-next` will not create any worker
	 * threads and will do the minification in the main thread.
	 *
	 * Note: If unable to do a structured clone of the `html-minifier-next`
	 * options according to the
	 * [HTML structured clone
	 * algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm),
	 * `astro-html-minifier-next` will do the minification on the main
	 * thread, even if this option is not set to `0`.
	 *
	 * @default `Math.max(1, os.availableParallelism() - 1)`
	 */
	maxWorkers?: number;
}

/**
 * Check if a value can be transferred to a worker.
 * @param {*} value
 * @returns {boolean}
 */
function isTransferable(value: unknown): boolean {
	try {
		// Attempt to do a structured clone of the value.
		// If it succeeds, it should be transferable to a worker.
		structuredClone(value);
		return true;
	} catch {
		return false;
	}
}

/**
 * An Astro integration that minifies HTML assets using
 * [html-minifier-next](https://www.npmjs.com/package/html-minifier-next).
 *
 * @param options The options passed to the `minify` function of
 *   [html-minifier-next](https://www.npmjs.com/package/html-minifier-next).
 * @returns The Astro integration.
 */
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

				const availableParallelism = getAvailableParallelism();
				const {
					maxWorkers = Math.max(1, availableParallelism - 1),
					...minifyHtmlOptions
				} = options;

				let workerPool: MinifyHTMLWorkerPool | undefined;
				if (maxWorkers > 0 && isTransferable(minifyHtmlOptions)) {
					workerPool = new MinifyHTMLWorkerPool(maxWorkers, minifyHtmlOptions);
				}

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
							const { savings, time } = workerPool
								? await workerPool.minifyHTMLFile(assetPath)
								: await minifyHTMLFile(assetPath, minifyHtmlOptions, signal);
							if (savings <= 0) {
								// No savings, so we skip logging.
								// TODO: Also log when it got bigger - Probably more informative for the user.
								return;
							}

							// Log a nice summary of the minification savings and the time it took.
							const savingsStr =
								savings < 1024
									? `${savings}B`
									: savings < 1048576
										? `${(savings / 1024).toFixed(1)}kB`
										: `${(savings / 1048576).toFixed(2)}MB`;
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

				// We use a quadruple of the available parallelism here, even if we don't actually run the tasks in different threads or anything.
				// The available parallelism is a good indicator of machine capabilities, and the multiplier gives a good balance of speed and resource usage.
				const maxExecutingTasksSize = availableParallelism * 4;

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
