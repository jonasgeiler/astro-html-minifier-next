import { Worker, type WorkerOptions } from "node:worker_threads";
import { debuglog, type DebugLoggerFunction } from 'node:util';

let debug: DebugLoggerFunction = debuglog('astro-html-minifier-next', (optimizedDebug) => {
	// Replace with a logging function that optimizes out testing if the section is enabled.
	debug = optimizedDebug;
});

interface WorkerWithPromise extends Worker {
	_currentPromise?: {
		resolve: (value: unknown) => void;
		reject: (reason?: unknown) => void;
	};
}

class WorkerPool {
	protected workerFilename;
	protected maxWorkers;

	protected pool: Set<Worker>;
	protected idle: Worker[];
	protected queue: ((value: Worker) => void)[];

	constructor(filename: string | URL, maxWorkers: number) {
		this.workerFilename = filename;
		this.maxWorkers = maxWorkers;

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
			const worker = new Worker(this.workerFilename) as WorkerWithPromise;

			worker.on("message", async (message: { result: unknown } | { error: unknown }) => {
				debug("worker '%s' sent a message: %O", worker, message);

				if (worker._currentPromise) {
					if ('result' in message) {
						worker._currentPromise.resolve(message.result);
					} else {
						worker._currentPromise.reject(message.error);
					}
					worker._currentPromise = undefined;
				}

				this.releaseWorker(worker);
			})

			worker.on("error", (error) => {
				debug("worker '%s' encountered an error: %O", worker, error);

				if (worker._currentPromise) {
					worker._currentPromise.reject(error);
					worker._currentPromise = undefined;
				}
			});

			worker.on("exit", (exitCode) => {
				debug("worker '%s' exited with code %d", worker, exitCode);

				this.removeWorker(worker);

				if (exitCode !== 0 && worker._currentPromise) {
					worker._currentPromise.reject(new Error(`Worker failed with exit code ${exitCode}.`));
					worker._currentPromise = undefined;
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

	public async runTask(taskData: unknown): Promise<unknown> {
		return new Promise(async (resolve, reject) => {
			const worker = await this.getAvailableWorker();
			worker._currentPromise = { resolve, reject };
			worker.postMessage(taskData);
		});
	}
}
