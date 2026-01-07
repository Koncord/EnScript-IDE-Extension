import { parseWidgetStylesFromString } from '../../../server/src/server/enfusionparser/widgetStylesAdapter';

describe('Widget Styles Parser', () => {
    it('should parse DayZ widget styles structure', () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<WidgetStyles>
    <Widget Name="TextWidget">
        <Style Name="Normal" Font="gui/fonts/MetronBook" ImageSet="" Color="4294967295" />
        <Style Name="Bold" Font="gui/fonts/MetronBook-Bold" ImageSet="" Color="4294967295" />
    </Widget>
    <Widget Name="ButtonWidget">
        <Style Name="Default" Font="gui/fonts/MetronBook" ImageSet="dayz_gui" Color="4294967295">
            <State Name="Normal">
                <Item Name="Background" Image="ButtonNormal" />
                <Item Name="Border" Image="ButtonBorder" />
            </State>
            <State Name="Focus">
                <Item Name="Background" Image="ButtonFocus" />
                <Item Name="Border" Image="ButtonBorder" />
            </State>
        </Style>
    </Widget>
</WidgetStyles>`;

        const result = parseWidgetStylesFromString(xml);
        
        expect(result).not.toBeNull();
        expect(result?.widgets).toHaveLength(2);
        
        // Check TextWidget
        const textWidget = result?.widgets.find(w => w.name === 'TextWidget');
        expect(textWidget).toBeDefined();
        expect(textWidget?.styles).toHaveLength(2);
        
        const normalStyle = textWidget?.styles.find(s => s.name === 'Normal');
        expect(normalStyle).toBeDefined();
        expect(normalStyle?.font).toBe('gui/fonts/MetronBook');
        expect(normalStyle?.color).toBe('4294967295');
        expect(normalStyle?.states).toHaveLength(0);
        
        // Check ButtonWidget with states
        const buttonWidget = result?.widgets.find(w => w.name === 'ButtonWidget');
        expect(buttonWidget).toBeDefined();
        expect(buttonWidget?.styles).toHaveLength(1);
        
        const defaultStyle = buttonWidget?.styles[0];
        expect(defaultStyle?.name).toBe('Default');
        expect(defaultStyle?.font).toBe('gui/fonts/MetronBook');
        expect(defaultStyle?.imageSet).toBe('dayz_gui');
        expect(defaultStyle?.states).toHaveLength(2);
        
        const normalState = defaultStyle?.states.find(s => s.name === 'Normal');
        expect(normalState).toBeDefined();
        expect(normalState?.items).toHaveLength(2);
        expect(normalState?.items[0].name).toBe('Background');
        expect(normalState?.items[0].image).toBe('ButtonNormal');
        
        const focusState = defaultStyle?.states.find(s => s.name === 'Focus');
        expect(focusState).toBeDefined();
        expect(focusState?.items).toHaveLength(2);
    });

    it('should handle single widget with single style', () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<WidgetStyles>
    <Widget Name="SimpleWidget">
        <Style Name="Simple" Font="font1" ImageSet="set1" Color="12345" />
    </Widget>
</WidgetStyles>`;

        const result = parseWidgetStylesFromString(xml);
        
        expect(result).not.toBeNull();
        expect(result?.widgets).toHaveLength(1);
        expect(result?.widgets[0].name).toBe('SimpleWidget');
        expect(result?.widgets[0].styles[0].name).toBe('Simple');
        expect(result?.widgets[0].styles[0].font).toBe('font1');
    });

    it('should handle empty widget styles document', () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<WidgetStyles>
</WidgetStyles>`;

        const result = parseWidgetStylesFromString(xml);
        
        expect(result).not.toBeNull();
        expect(result?.widgets).toHaveLength(0);
    });

    it('should handle malformed XML gracefully', () => {
        const xml = `<Invalid>This is not valid XML`;
        
        const result = parseWidgetStylesFromString(xml);
        
        // fast-xml-parser is lenient and may parse incomplete XML
        // It returns an empty widgets array for documents without proper WidgetStyles structure
        expect(result).not.toBeNull();
        expect(result?.widgets).toHaveLength(0);
    });
});

