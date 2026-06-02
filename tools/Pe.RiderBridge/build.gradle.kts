plugins {
    id("java")
    id("org.jetbrains.intellij.platform") version "2.10.4"
}

group = "pe.tools"
version = "0.1.0"

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

intellijPlatform {
    pluginConfiguration {
        id = "pe.tools.riderbridge"
        name = "Pe.RiderBridge"
        version = project.version.toString()
        ideaVersion {
            sinceBuild = "252"
            untilBuild = "261.*"
        }
    }
}

dependencies {
    intellijPlatform {
        rider("2025.2")
        instrumentationTools()
    }
}
