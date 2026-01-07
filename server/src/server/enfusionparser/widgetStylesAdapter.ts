/**
 * Adapter for parsing DayZ widget styles files (.styles)
 * These files define styling information for GUI widgets in DayZ
 */

import { XMLParser } from 'fast-xml-parser';
import * as fs from 'fs';

/**
 * Style state item (e.g., Background, Border elements in Normal/Focus states)
 */
export interface StyleStateItem {
    name: string;
    image: string;
}

/**
 * Style state definition (e.g., Normal, Focus, Disabled)
 */
export interface StyleState {
    name: string;
    items: StyleStateItem[];
}

/**
 * Widget style definition
 */
export interface WidgetStyle {
    name: string;
    font: string;
    imageSet: string;
    color: string;
    states: StyleState[];
}

/**
 * Widget definition containing multiple styles
 */
export interface Widget {
    name: string;
    styles: WidgetStyle[];
}

/**
 * Widget styles document structure
 */
export interface WidgetStylesDocument {
    widgets: Widget[];
}

/**
 * Parse a DayZ widget styles file
 * @param filePath Path to the .styles file (e.g., P:\gui\looknfeel\dayzwidgets.styles)
 * @returns Parsed widget styles document or null if parsing fails
 */
export function parseWidgetStyles(filePath: string): WidgetStylesDocument | null {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return parseWidgetStylesFromString(content);
    } catch (error) {
        console.error(`Error parsing widget styles file ${filePath}:`, error);
        return null;
    }
}

/**
 * Parse widget styles from string content
 * @param content XML content string
 * @returns Parsed widget styles document or null if parsing fails
 */
export function parseWidgetStylesFromString(content: string): WidgetStylesDocument | null {
    try {
        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            parseAttributeValue: false,
            parseTagValue: false,
            trimValues: true,
            processEntities: true,
            ignoreDeclaration: false,
        });

        const parsed = parser.parse(content);
        
        const widgets: Widget[] = [];
        
        // Handle WidgetStyles root element
        if (parsed.WidgetStyles) {
            const widgetStylesNode = parsed.WidgetStyles;
            
            if (widgetStylesNode.Widget) {
                const widgetEntries = Array.isArray(widgetStylesNode.Widget) 
                    ? widgetStylesNode.Widget 
                    : [widgetStylesNode.Widget];
                
                for (const widgetEntry of widgetEntries) {
                    const widget: Widget = {
                        name: widgetEntry['@_Name'] || 'unnamed',
                        styles: []
                    };
                    
                    if (widgetEntry.Style) {
                        const styleEntries = Array.isArray(widgetEntry.Style) 
                            ? widgetEntry.Style 
                            : [widgetEntry.Style];
                        
                        for (const styleEntry of styleEntries) {
                            const style: WidgetStyle = {
                                name: styleEntry['@_Name'] || 'unnamed',
                                font: styleEntry['@_Font'] || '',
                                imageSet: styleEntry['@_ImageSet'] || '',
                                color: styleEntry['@_Color'] || '',
                                states: []
                            };
                            
                            // Parse states if they exist
                            if (styleEntry.State) {
                                const stateEntries = Array.isArray(styleEntry.State) 
                                    ? styleEntry.State 
                                    : [styleEntry.State];
                                
                                for (const stateEntry of stateEntries) {
                                    const state: StyleState = {
                                        name: stateEntry['@_Name'] || 'unnamed',
                                        items: []
                                    };
                                    
                                    if (stateEntry.Item) {
                                        const itemEntries = Array.isArray(stateEntry.Item) 
                                            ? stateEntry.Item 
                                            : [stateEntry.Item];
                                        
                                        for (const itemEntry of itemEntries) {
                                            state.items.push({
                                                name: itemEntry['@_Name'] || '',
                                                image: itemEntry['@_Image'] || ''
                                            });
                                        }
                                    }
                                    
                                    style.states.push(state);
                                }
                            }
                            
                            widget.styles.push(style);
                        }
                    }
                    
                    widgets.push(widget);
                }
            }
        }
        
        return {
            widgets
        };
    } catch (error) {
        console.error(`Error parsing widget styles content:`, error);
        return null;
    }
}
