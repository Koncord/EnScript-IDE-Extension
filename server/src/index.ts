import { EnscriptLanguageServer } from './lsp/server';
import { Logger } from './util/logger';
import { defaultConfig } from './server/ast/config';

import { Container } from 'inversify';
import { configureAnalyzerContainer } from './server/di';
import { configureServerContainer } from './lsp/di';


Logger.configure(defaultConfig, {
    prefix: 'EnScript-LSP'
});

const container = new Container();

// Configure analyzer DI container
configureAnalyzerContainer(container);

configureServerContainer(container);

container.get(EnscriptLanguageServer).start();

