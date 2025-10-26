/**
 * Virtual document containing engine-provided constants
 * 
 * These constants are implicitly available in EnScript/DayZ but are not
 * defined in any source file. This virtual document is parsed once and
 * cached, making these constants available for symbol lookup and diagnostics.
 */

import { TextDocument } from 'vscode-languageserver-textdocument';

/**
 * Virtual URI for the engine constants document
 */
export const ENGINE_CONSTANTS_URI = 'enscript://engine/constants.c';

/**
 * Source code for engine-provided constants
 */
export const ENGINE_CONSTANTS_SOURCE = `
// Dialog Box Button constants
const int DBB_NONE = 0;
const int DBB_OK = 1;
const int DBB_YES = 2;
const int DBB_NO = 3;
const int DBB_CANCEL = 4;

// Dialog Box Type constants
const int DBT_OK = 0;
const int DBT_YESNO = 1;
const int DBT_YESNOCANCEL = 2;

// Dialog Message Type constants
const int DMT_NONE = 0;
const int DMT_INFO = 1;
const int DMT_WARNING = 2;
const int DMT_QUESTION = 3;
const int DMT_EXCLAMATION = 4;

const int ObjIntersectFire = 0;
const int ObjIntersectView = 1;
const int ObjIntersectGeom = 2;
const int ObjIntersectIFire = 3;
const int ObjIntersectNone = 4;

const int VoiceEffectMumbling = 1;
const int VoiceEffectExtortion = 2;
const int VoiceEffectObstruction = 3;

const int LOCK_FROM_SCRIPT = 1;


const int DT_CLOSE_COMBAT = 1;
const int DT_FIRE_ARM = 2;
const int DT_EXPLOSION = 3;
const int DT_CUSTOM = 4;


const int UAUIMenu = 0;
const int UALeanLeft = 1;
const int UALeanRight = 2;
const int UADefaultAction = 3;
const int UAGear = 4;
const int UATempRaiseWeapon = 5;

`;

/**
 * Create a TextDocument for the engine constants
 */
export function createEngineConstantsDocument(): TextDocument {
    return TextDocument.create(
        ENGINE_CONSTANTS_URI,
        'enscript',
        1,
        ENGINE_CONSTANTS_SOURCE
    );
}
