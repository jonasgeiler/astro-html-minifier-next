import { Worker, type WorkerOptions } from "node:worker_threads";

class WorkerPool {
	protected workerFilename;
	protected maxWorkers;

	protected pool: Set<Worker>;
	protected idleWorkers: Worker[];
	protected queue: any[];

	constructor(filename: string | URL, maxWorkers: number) {
		this.workerFilename = filename;
		this.maxWorkers = maxWorkers;

		this.pool = new Set();
		this.idleWorkers = [];
		this.queue = [];
	}

	async getAvailableWorker() {
		if (this.idleWorkers.length) {
			const worker = this.idleWorkers.shift();
			if (worker !== undefined) return worker;
		}

		if (this.pool.size < this.maxWorkers) {
			const worker = new Worker(this.workerFilename);
			this.pool.add(worker);
			return worker;
		}

		return new Promise<Worker>(resolve => {
			// When a worker frees up, they will check the queue and resolve this promise.
			this.queue.push(resolve);
		});
	}

	async runTask(taskData) {
		return new Promise(async (resolve, reject) => {
			const worker = await this.getAvailableWorker();

			worker.once('error', (error) => {
				reject(error);
			});

			worker.once('exit', (exitCode) => {
				this.pool.delete(worker);

				if (exitCode !== 0) {
					reject(new Error(`Worker failed with exit code ${exitCode}.`));
				}
			});
		});
	}
}
