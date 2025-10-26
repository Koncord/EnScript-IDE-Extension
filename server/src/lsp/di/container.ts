import { Container } from 'inversify';

import { EnscriptLanguageServer } from '../server';
import { ServerConfigurationManager } from '../server-config';
import { NotificationService } from '../services/NotificationService';
import { IndexerService } from '../services/IndexerService';
import { IIndexerService } from '../services/IIndexerService';
import { SERVICE_TYPES } from '../services/service-types';

// Import all handler classes
import { CompletionHandler } from '../handlers/completion';
import { DefinitionHandler } from '../handlers/definition';
import { HoverHandler } from '../handlers/hover';
import { ReferencesHandler } from '../handlers/references';
import { RenameHandler } from '../handlers/rename';
import { WorkspaceSymbolHandler } from '../handlers/workspaceSymbol';
import { DiagnosticsHandler } from '../handlers/diagnostics';
import { DumpDiagnosticsHandler } from '../handlers/dumpDiagnostics';
import { DumpClassesHandler } from '../handlers/dumpClasses';
import { ProjectFileHandler } from '../handlers/projectFile';
import { CodeActionsHandler } from '../handlers/codeActions';
import { IHandlerRegistration, HANDLER_TYPES } from '../handlers/handler-interfaces';
import { INotificationService } from '../services/INotificationService';

export function configureServerContainer(
    container: Container
): void {

    container.bind(Container).toConstantValue(container);

    // Singletons - Stateful services that need to be shared
    container.bind(ServerConfigurationManager).toSelf().inSingletonScope();
    container.bind(EnscriptLanguageServer).toSelf().inSingletonScope();
    container.bind<INotificationService>(SERVICE_TYPES.INotificationService).to(NotificationService).inSingletonScope();
    container.bind<IIndexerService>(SERVICE_TYPES.IIndexerService).to(IndexerService).inSingletonScope();

    // Transient - Stateless handlers that can be created per registration
    container.bind<IHandlerRegistration>(HANDLER_TYPES.IHandlerRegistration).to(CompletionHandler).inTransientScope();
    container.bind<IHandlerRegistration>(HANDLER_TYPES.IHandlerRegistration).to(DefinitionHandler).inTransientScope();
    container.bind<IHandlerRegistration>(HANDLER_TYPES.IHandlerRegistration).to(HoverHandler).inTransientScope();
    container.bind<IHandlerRegistration>(HANDLER_TYPES.IHandlerRegistration).to(ReferencesHandler).inTransientScope();
    container.bind<IHandlerRegistration>(HANDLER_TYPES.IHandlerRegistration).to(RenameHandler).inTransientScope();
    container.bind<IHandlerRegistration>(HANDLER_TYPES.IHandlerRegistration).to(WorkspaceSymbolHandler).inTransientScope();
    container.bind<IHandlerRegistration>(HANDLER_TYPES.IHandlerRegistration).to(DiagnosticsHandler).inTransientScope();
    container.bind<IHandlerRegistration>(HANDLER_TYPES.IHandlerRegistration).to(DumpDiagnosticsHandler).inTransientScope();
    container.bind<IHandlerRegistration>(HANDLER_TYPES.IHandlerRegistration).to(DumpClassesHandler).inTransientScope();
    container.bind<IHandlerRegistration>(HANDLER_TYPES.IHandlerRegistration).to(ProjectFileHandler).inTransientScope();
    container.bind<IHandlerRegistration>(HANDLER_TYPES.IHandlerRegistration).to(CodeActionsHandler).inTransientScope();
}