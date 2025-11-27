// Base SDK classes for testing
// This file contains common base classes that are used across tests

class Class {
    proto static Class Cast(Class from);
}


class Managed extends Class {}

class IEntity extends Managed {}

class Object extends IEntity {}

class ObjectTyped extends Object {}

class Entity extends ObjectTyped {}

class EntityAI extends Entity {}

class Man extends EntityAI {}

class PlayerBase extends Man {
    void SomeMethod() {}
    int GetHealth() { return 100; }
    bool m_ActionQBControl;
}

class DayZPlayer extends PlayerBase {}

class PlayerIdentity {
}

class ParamsReadContext {
}
