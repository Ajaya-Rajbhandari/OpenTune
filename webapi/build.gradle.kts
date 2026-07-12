plugins {
    application
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

kotlin {
    jvmToolchain(21)
}

application {
    mainClass.set("com.arturo254.opentune.webapi.WebApiKt")
}

dependencies {
    implementation(project(":innertube"))
    implementation(project(":lrclib"))
    implementation(project(":kugou"))

    implementation(libs.ktor.server.core)
    implementation(libs.ktor.server.cio)
    implementation(libs.ktor.server.content.negotiation)
    implementation(libs.ktor.client.core)
    implementation(libs.ktor.serialization.json)

    testImplementation(kotlin("test"))
    testImplementation(libs.ktor.server.test.host)
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
}
