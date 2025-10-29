import { Worker } from "node:worker_threads";
import { debuglog, type DebugLoggerFunction } from 'node:util';
import type { MinifierOptions as HtmlMinifierNextOptions } from "html-minifier-next";

let debug: DebugLoggerFunction = debuglog('astro-html-minifier-next', (optimizedDebug) => {
	// Replace with a logging function that optimizes out testing if the section is enabled.
	debug = optimizedDebug;
});

interface WorkerWithPromise extends Worker {
	_currentResolve?: (value: string) => void;
	_currentReject?: (reason?: unknown) => void;
}

export class MinifyHtmlWorkerPool {
	protected maxWorkers: number;

	protected workerUrl: URL;
	protected pool: Set<Worker>;
	protected idle: Worker[];
	protected queue: ((value: Worker) => void)[];

	constructor(maxWorkers: number) {
		this.maxWorkers = maxWorkers;

		this.workerUrl = new URL('./minify-html-worker.js', import.meta.url);
		this.pool = new Set();
		this.idle = [];
		this.queue = [];
	}

	protected async getAvailableWorker(): Promise<WorkerWithPromise> {
		// If there is an idle worker, use it.
		if (this.idle.length) {
			const worker = this.idle.shift();
			if (worker !== undefined) {
				return worker;
			}
		}

		// If we can create a new worker, do so.
		if (this.pool.size < this.maxWorkers) {
			const worker = new Worker(this.workerUrl) as WorkerWithPromise;

			worker.on("message", async (message: { result: string } | { error?: unknown }) => {
				debug("worker '%s' sent a message: %O", worker, message);

				if ('result' in message) {
					worker._currentResolve?.(message.result);
				} else {
					worker._currentReject?.(message.error);
				}
				worker._currentResolve = undefined;
				worker._currentReject = undefined;

				this.releaseWorker(worker);
			})

			worker.on("error", (error) => {
				debug("worker '%s' encountered an error: %O", worker, error);

				worker._currentReject?.(error);
				worker._currentResolve = undefined;
				worker._currentReject = undefined;
			});

			worker.on("exit", (exitCode) => {
				debug("worker '%s' exited with code %d", worker, exitCode);

				this.removeWorker(worker);

				if (exitCode !== 0) {
					worker._currentReject?.(new Error(`Worker failed with exit code ${exitCode}.`));
					worker._currentResolve = undefined;
					worker._currentReject = undefined;
				}
			});

			this.pool.add(worker);
			return worker;
		}

		// Otherwise, wait for a worker to free up.
		return new Promise<Worker>(resolve => {
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

	public async minifyHtml(html: string, minifyHtmlOptions: HtmlMinifierNextOptions): Promise<string> {
		const worker = await this.getAvailableWorker();

		return new Promise<string>((resolve, reject) => {
			worker._currentResolve = resolve;
			worker._currentReject = reject;
			worker.postMessage({ html, minifyHtmlOptions });
		});
	}

	// TODO: Destroy function
}
