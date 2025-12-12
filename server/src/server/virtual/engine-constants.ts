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
const int UAUIGesturesOpen = 6;
const int UAChat = 7;
const int UAUIQuickbarToggle = 8;
const int UAZeroingUp = 9;
const int UAZeroingDown = 10;
const int UAToggleWeapons = 11;
const int UANextActionCategory = 12;
const int UAPrevActionCategory = 13;
const int UANextAction = 14;
const int UAPrevAction = 15;
const int UAMapToggle = 16;
const int UAUIBack = 17;
const int UAUIQuickbarRadialOpen = 18;
const int UAWalkRunForced = 19;
const int UAUISelect = 20;
const int UAAction = 21;
const int UAUICtrlX = 22;
const int UAUICtrlY = 23;
const int UAUIThumbRight = 24;
const int UAUICopyDebugMonitorPos = 25;
const int UAUITabLeft = 26;
const int UAUITabRight = 27;
const int UASwitchPreset = 28;
const int UAUIDown = 29;
const int UAUIUp = 30;
const int UAUIRight = 31;
const int UAUILeft = 32;
const int UAUINextUp = 33;
const int UAUINextDown = 34;
const int UAUICredits = 35;
const int UAUIRotateInventory = 36;
const int UAUICombine = 37;
const int UAPersonView = 38;
const int UAAimRight = 39;
const int UAAimLeft = 40;
const int UALookAround = 41;
const int UAGetOver = 42;
const int UAMoveForward = 43;
const int UAMoveBack = 44;
const int UAReloadMagazine = 45;
const int UATurbo = 46;
const int UAWalkRunTemp = 47;


const WidgetType TextWidgetTypeID = 0;
const WidgetType MultilineTextWidgetTypeID = 1;
const WidgetType MultilineEditBoxWidgetTypeID = 2;
const WidgetType RichTextWidgetTypeID = 3;
const WidgetType RenderTargetWidgetTypeID = 4;
const WidgetType ImageWidgetTypeID = 5;
const WidgetType ConsoleWidgetTypeID = 6;
const WidgetType VideoWidgetTypeID = 7;
const WidgetType RTTextureWidgetTypeID = 8;
const WidgetType FrameWidgetTypeID = 9;
const WidgetType EmbededWidgetTypeID = 10;
const WidgetType ButtonWidgetTypeID = 11;
const WidgetType CheckBoxWidgetTypeID = 12;
const WidgetType WindowWidgetTypeID = 13;
const WidgetType ComboBoxWidgetTypeID = 14;
const WidgetType SimpleProgressBarWidgetTypeID = 15;
const WidgetType ProgressBarWidgetTypeID = 16;
const WidgetType SliderWidgetTypeID = 17;
const WidgetType BaseListboxWidgetTypeID = 18;
const WidgetType TextListboxWidgetTypeID = 19;
const WidgetType GenericListboxWidgetTypeID = 20;
const WidgetType EditBoxWidgetTypeID = 21;
const WidgetType PasswordEditBoxWidgetTypeID = 22;
const WidgetType WorkspaceWidgetTypeID = 23;
const WidgetType GridSpacerWidgetTypeID = 24;
const WidgetType WrapSpacerWidgetTypeID = 25;
const WidgetType ScrollWidgetTypeID = 26;

const int MB_PRESSED_MASK = 1;

ScriptModule g_Script;

const int CT_INT = 1;
const int CT_FLOAT = 2;
const int CT_STRING = 3;
const int CT_ARRAY = 4;
const int CT_CLASS = 5;
const int CT_OTHER = 6;

const int VoiceLevelWhisper = 0;
const int VoiceLevelTalk = 1;
const int VoiceLevelShout = 2;

// const EventType WindowsResizeEventTypeID = 1; // unsure about it.

const int EUAINPUT_DEVICE_KEYBOARD = 1;
const int EUAINPUT_DEVICE_MOUSE = 2;
const int EUAINPUT_DEVICE_KEYBOARDMOUSE = 3;
const int EUAINPUT_DEVICE_CONTROLLER = 4;
const int EUAINPUT_DEVICE_IR  = 5;

enum LinebreakOverrideMode
{
	LINEBREAK_DEFAULT,
	LINEBREAK_WESTERN,
	LINEBREAK_ASIAN
};

const int HIDE_INV_FROM_SCRIPT = 1;

const int CCSystem = 0;
const int CCAdmin = 1;
const int CCDirect = 2;
const int CCMegaphone = 3;
const int CCTransmitter = 4;
const int CCPublicAddressSystem = 5;
const int CCBattlEye = 6;

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
