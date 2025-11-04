// Base SDK classes for testing
// This file contains common base classes that are used across tests

class Class {
    proto static Class Cast(Class from);
}

class Entity extends Class {}

class Man extends Entity {}

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
