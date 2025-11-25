import { readFile, writeFile } from "node:fs/promises";
import { availableParallelism as getAvailableParallelism } from "node:os";
import { relative as getRelativePath } from "node:path";
import { fileURLToPath } from "node:url";
import { styleText } from "node:util";
import type { AstroIntegration } from "astro";
import { type MinifierOptions, minify as minifyHTML } from "html-minifier-next";

/**
 * Options from
 * [html-minifier-next](https://www.npmjs.com/package/html-minifier-next),
 * extended with some options only used by the {@link htmlMinifier}
 * Astro integration.
 */
export interface HTMLMinifierOptions extends MinifierOptions {
	/**
	 * This option is only used by the {@link htmlMinifier} Astro integration.
	 *
	 * If `true`, the HTML assets will always be overwritten with their
	 * minified HTML, even if it would result in a larger file size than
	 * the original.
	 *
	 * @default false
	 */
	alwaysWriteMinifiedHTML?: boolean;
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
	options: HTMLMinifierOptions = {},
): AstroIntegration {
	// API Reference: https://docs.astro.build/en/reference/integrations-reference/
	return {
		name: "astro-html-minifier-next",
		hooks: {
			"astro:build:done": async ({
				assets,
				dir: distUrl,
				logger,
			}): Promise<void> => {
				logger.info(styleText(["bgGreen", "black"], " minifying html assets "));

				const totalTimeStart = performance.now(); // --- TOTAL TIMED BLOCK START ---

				const {
					alwaysWriteMinifiedHTML = false,
					...minifyHTMLOptions // Rest of the options go to html-minifier-next.
				} = options;

				const tasks: (() => Promise<void>)[] = [];
				let tasksTotal = 0;
				let tasksDone = 0;

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
							const minifiedHTML = await minifyHTML(html, minifyHTMLOptions);

							const savings =
								Buffer.byteLength(html) - Buffer.byteLength(minifiedHTML);
							const hasSavings = savings > 0;
							if (hasSavings || alwaysWriteMinifiedHTML) {
								// Only write the minified HTML to the file if it's smaller,
								// or if alwaysWriteMinifiedHTML is enabled.
								await writeFile(assetPath, minifiedHTML, {
									encoding: "utf8",
									signal,
								});
							}

							const timeEnd = performance.now(); // --- TIMED BLOCK END ---
							const time = timeEnd - timeStart;

							// Log a nice summary of the minification savings and the time it
							// took.
							const savingsSign = hasSavings ? "-" : "+";
							const savingsAbs = Math.abs(savings);
							const savingsWithUnit =
								savingsAbs < 1024
									? `${savingsAbs}B`
									: savingsAbs < 1048576
										? `${(savingsAbs / 1024).toFixed(1)}kB`
										: `${(savingsAbs / 1048576).toFixed(2)}MB`;
							const timeWithUnit =
								time < 1000
									? `${Math.round(time)}ms`
									: `${(time / 1000).toFixed(2)}s`;
							const savingsNote =
								hasSavings || alwaysWriteMinifiedHTML
									? hasSavings
										? ""
										: ", always write enabled"
									: ", skipped";
							logger.info(
								logLineAssetPath +
									styleText(
										hasSavings ? "dim" : "yellow",
										`(${savingsSign}${savingsWithUnit}${savingsNote}) `,
									) +
									styleText(
										"dim",
										`(+${timeWithUnit}) (${++tasksDone}/${tasksTotal})`,
									),
							);
						});

						tasksTotal++;
					}
				}

				// We use a quadruple of the available parallelism here, even if we
				// don't actually run the tasks in different threads or anything. The
				// available parallelism is a good indicator of machine capabilities,
				// and the multiplier gives a good balance of speed and resource usage.
				const maxExecutingTasksSize = getAvailableParallelism() * 4;

				// This holds the current batch of promises that are waiting to fulfill.
				const executingTasks = new Set<Promise<void>>();

				// Batch the tasks to avoid minifying too many files at once, which
				// could lead to memory and performance issues.
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
						// If the amount of executing tasks reaches the limit, we wait
						// until the one of them finishes, and therefore gets deleted from
						// the list, before continuing with the next task.
						await Promise.race(executingTasks);
					}

					if (signal.aborted) {
						throw signal.reason;
					}
				}

				// Wait for any remaining tasks to finish.
				await Promise.all(executingTasks);

				const totalTimeEnd = performance.now(); // --- TOTAL TIMED BLOCK END ---
				const totalTime = totalTimeEnd - totalTimeStart;

				// Log how long processing all assets took.
				const totalTimeWithUnit =
					totalTime < 1000
						? `${Math.round(totalTime)}ms`
						: `${(totalTime / 1000).toFixed(2)}s`;
				logger.info(styleText("green", `✓ Completed in ${totalTimeWithUnit}.`));
			},
		},
	};
}
