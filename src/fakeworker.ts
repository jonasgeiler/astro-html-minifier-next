import { EventEmitter } from 'node:events';

class FakeWorker extends EventEmitter {
	protected filename: string;
	protected workerFunction?: Function;

	constructor(filename: string) {
		super({ captureRejections: true });
		this.filename = filename;
	}

	async getWorkerFunction() {
		if (this.workerFunction) {
			return this.workerFunction;
		}

		const { default: workerFunction } = await import(this.filename);
		if (typeof workerFunction !== 'function') {
			throw new Error(`The module '${this.filename}' does not export a default function.`);
		}
		this.workerFunction = workerFunction;
		return workerFunction;
	}

	postMessage(value: any) {
		this.getWorkerFunction()
			.then(workerFunction => {
				try {
					const returnValue = workerFunction(value);

					if (returnValue instanceof Promise) {
						returnValue
							.then(resolvedValue => {
								this.emit("message", resolvedValue);
							})
							.catch(error => {
								this.emit("error", error);
							});
					} else {
						this.emit("message", returnValue);
					}
				} catch (error) {
					this.emit("error", error);
				}
			})
			.catch(error => {
				this.emit("error", error);
			});
	}
}
