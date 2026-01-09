/// <reference types="@types/vscode-webview" />

import { ModelViewer } from './ModelViewer';
import { ResourceLoader } from './ResourceLoader';

const vscode = acquireVsCodeApi<void>();
const resourceLoader = new ResourceLoader(vscode);
new ModelViewer(resourceLoader);
