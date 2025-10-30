import { Worker } from "node:worker_threads";
import type { MinifierOptions as MinifyHTMLOptions } from "html-minifier-next";
import type { MinifyHTMLFileResult } from "./minify-html-file.js";

interface WorkerWithPromise<T> extends Worker {
	_currentResolve?: (value: T) => void;
	_currentReject?: (reason?: unknown) => void;
}

export type MinifyHTMLWorkerInput = string;
export type MinifyHTMLWorkerOutput = MinifyHTMLFileResult | { error: unknown };

export class MinifyHTMLWorkerPool {
	protected maxWorkers: number;
	protected minifyHTMLOptions: MinifyHTMLOptions;

	protected workerUrl: URL;
	protected pool: Set<Worker>;
	protected idle: Worker[];
	protected queue: ((value: Worker) => void)[];

	constructor(maxWorkers: number, minifyHTMLOptions: MinifyHTMLOptions) {
		this.maxWorkers = maxWorkers;
		this.minifyHTMLOptions = minifyHTMLOptions;

		this.workerUrl = new URL("./minify-html-worker.js", import.meta.url);
		this.pool = new Set();
		this.idle = [];
		this.queue = [];
	}

	protected async getAvailableWorker(): Promise<
		WorkerWithPromise<MinifyHTMLFileResult>
	> {
		// If there is an idle worker, use it.
		if (this.idle.length) {
			const worker = this.idle.shift();
			if (worker !== undefined) {
				return worker;
			}
		}

		// If we can create a new worker, do so.
		if (this.pool.size < this.maxWorkers) {
			const worker = new Worker(this.workerUrl, {
				workerData: this.minifyHTMLOptions,
			}) as WorkerWithPromise<MinifyHTMLFileResult>;

			worker.on("message", async (message: MinifyHTMLWorkerOutput) => {
				if ("error" in message) {
					worker._currentReject?.(message.error);
				} else {
					worker._currentResolve?.(message);
				}
				worker._currentResolve = worker._currentReject = undefined;

				this.releaseWorker(worker);
			});

			worker.on("error", (error) => {
				worker._currentReject?.(error);
				worker._currentResolve = worker._currentReject = undefined;
			});

			worker.on("exit", (exitCode) => {
				this.removeWorker(worker);

				if (exitCode !== 0) {
					worker._currentReject?.(
						new Error(`Worker failed with exit code ${exitCode}.`),
					);
					worker._currentResolve = worker._currentReject = undefined;
				}
			});

			this.pool.add(worker);
			return worker;
		}

		// Otherwise, wait for a worker to free up.
		return new Promise<Worker>((resolve) => {
			// When a worker frees up, they will check the queue and resolve this promise.
			this.queue.push(resolve);
		});
	}

	protected releaseWorker(worker: Worker): void {
		// If there is a queued request for a worker, resolve it.
		if (this.queue.length) {
			const resolve = this.queue.shift();
			if (resolve !== undefined) {
				resolve(worker);
				return;
			}
		}

		// Otherwise, keep the worker as idle.
		this.idle.push(worker);
	}

	protected removeWorker(worker: Worker): void {
		this.pool.delete(worker);

		// If a worker is force stopped by the system, it might still be in the idle list.
		const idleIndex = this.idle.indexOf(worker);
		if (idleIndex !== -1) {
			this.idle.splice(idleIndex, 1);
		}
	}

	public async minifyHTMLFile(
		htmlFile: string,
		// TODO: Signal?
	): Promise<MinifyHTMLFileResult> {
		const worker = await this.getAvailableWorker();

		return new Promise<MinifyHTMLFileResult>((resolve, reject) => {
			worker._currentResolve = resolve;
			worker._currentReject = reject;
			worker.postMessage(htmlFile satisfies MinifyHTMLWorkerInput);
		});
	}

	// TODO: Destroy function
}
