import { TypeMismatchRule } from '../../../server/src/server/diagnostics/rules/type-mismatch';
import {
    setupDiagnosticTestContainer,
    runDiagnosticRule,
    DiagnosticTestContext
} from '../../test-helpers/diagnostic-test-helper';

describe('TypeMismatchRule - out parameter with null', () => {
    let testContext: DiagnosticTestContext;
    let rule: TypeMismatchRule;

    beforeEach(() => {
        testContext = setupDiagnosticTestContainer();
        rule = new TypeMismatchRule();
    });

    it('should allow null for out Object parameter', async () => {
        const code = `
class TestClass {
    proto static bool RayCastBullet(vector begPos, vector endPos, PhxInteractionLayers layerMask, Object ignoreObj, out Object hitObject, out vector hitPosition, out vector hitNormal, out float hitFraction);

    void TestMethod() {
        vector start = "0 0 0";
        vector end = "10 10 10";
        vector hitPos, hitNorm;
        float hitFrac;
        Object hitObj;
    
        // Should allow null for out parameters
        RayCastBullet(start, end, 0, null, null, hitPos, hitNorm, hitFrac);
    }
}`;

        const results = await runDiagnosticRule(rule, code, testContext);

        // Should not report type mismatch for null passed to out Object parameter
        const nullOutParamErrors = results.filter(d =>
            d.message.includes("null") &&
            d.message.includes("Object")
        );
        expect(nullOutParamErrors).toHaveLength(0);
    });

    it('should allow null for out vector parameter', async () => {
        const code = `
class TestClass {
    proto static bool RayCastBullet(vector begPos, vector endPos, PhxInteractionLayers layerMask, Object ignoreObj, out Object hitObject, out vector hitPosition, out vector hitNormal, out float hitFraction);

    void TestMethod() {
        vector start = "0 0 0";
        vector end = "10 10 10";
        float hitFrac;
        Object hitObj;

        // Should allow null for out vector parameters
        RayCastBullet(start, end, 0, null, hitObj, null, null, hitFrac);
    }
}`;

        const results = await runDiagnosticRule(rule, code, testContext);

        // Should not report type mismatch for null passed to out vector parameters
        const nullOutParamErrors = results.filter(d =>
            d.message.includes("null") &&
            d.message.includes("vector")
        );
        expect(nullOutParamErrors).toHaveLength(0);
    });

    it('should allow null for out float parameter', async () => {
        const code = `
class TestClass {
    proto static bool RayCastBullet(vector begPos, vector endPos, PhxInteractionLayers layerMask, Object ignoreObj, out Object hitObject, out vector hitPosition, out vector hitNormal, out float hitFraction);

    void TestMethod() {
        vector start = "0 0 0";
        vector end = "10 10 10";
        vector hitPos, hitNorm;
        Object hitObj;

        // Should allow null for out float parameter
        RayCastBullet(start, end, 0, null, hitObj, hitPos, hitNorm, null);
    }
}`;

        const results = await runDiagnosticRule(rule, code, testContext);

        // Should not report type mismatch for null passed to out float parameter
        const nullOutParamErrors = results.filter(d =>
            d.message.includes("null") &&
            d.message.includes("float")
        );
        expect(nullOutParamErrors).toHaveLength(0);
    });

    it('should allow null for regular Object parameter (reference type)', async () => {
        const code = `
class PhxInteractionLayers {}
class Object {}

class TestClass {
    proto static bool RayCastBullet(vector begPos, vector endPos, PhxInteractionLayers layerMask, Object ignoreObj, out Object hitObject, out vector hitPosition, out vector hitNormal, out float hitFraction);

    void TestMethod() {
        vector start = "0 0 0";
        vector end = "10 10 10";
        vector hitPos, hitNorm;
        float hitFrac;
        Object hitObj;
        PhxInteractionLayers mask;

        // null is allowed for Object parameter (reference type) even without out modifier
        RayCastBullet(start, end, mask, null, hitObj, hitPos, hitNorm, hitFrac);
    }
}`;

        const results = await runDiagnosticRule(rule, code, testContext);

        // Should not report error for null passed to Object parameter
        const nullObjectErrors = results.filter(d =>
            d.message.includes("null") &&
            d.message.includes("Object")
        );
        expect(nullObjectErrors).toHaveLength(0);
    });
});
