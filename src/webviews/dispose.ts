import * as vscode from 'vscode';

/**
 * Dispose all items in an array and empty the array
 */
export function disposeAll(disposables: vscode.Disposable[]): void {
	while (disposables.length) {
		const item = disposables.pop();
		if (item) {
			item.dispose();
		}
	}
}

/**
 * Abstract base class for managing disposable resources.
 * Extends this class to automatically track and dispose of resources.
 */
export abstract class Disposable {
	private _isDisposed = false;

	protected _disposables: vscode.Disposable[] = [];

	public dispose(): void {
		if (this._isDisposed) {
			return;
		}
		this._isDisposed = true;
		disposeAll(this._disposables);
	}

	/**
	 * Register a disposable resource that will be disposed when this object is disposed.
	 * Returns the same value for convenience.
	 */
	protected _register<T extends vscode.Disposable>(value: T): T {
		if (this._isDisposed) {
			value.dispose();
		} else {
			this._disposables.push(value);
		}
		return value;
	}

	protected get isDisposed(): boolean {
		return this._isDisposed;
	}
}
