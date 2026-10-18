# kotlinx.serialization: keep generated serializers for our DTOs.
-keepattributes *Annotation*, InnerClasses, Signature
-dontnote kotlinx.serialization.**
-keep,includedescriptorclasses class com.iampauld3v.axon.**$$serializer { *; }
-keepclassmembers class com.iampauld3v.axon.** {
    *** Companion;
}
-keepclasseswithmembers class com.iampauld3v.axon.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Retrofit interfaces use generics + annotations.
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations
-keepclassmembers,allowshrinking,allowobfuscation interface * {
    @retrofit2.http.* <methods>;
}
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
