fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=assets/cyberlog.rc");
    println!("cargo:rerun-if-changed=assets/icon.ico");
    #[cfg(windows)]
    embed_resource::compile("assets/cyberlog.rc", embed_resource::NONE)
        .manifest_optional()
        .unwrap();
}
