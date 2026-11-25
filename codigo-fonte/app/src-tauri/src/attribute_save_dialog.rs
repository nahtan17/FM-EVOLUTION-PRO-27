//! The Windows save dialog for attribute exports. The selected path stays in the native app.

use std::ffi::OsString;
use std::io;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};

use windows_sys::Win32::UI::Controls::Dialogs::{
    CommDlgExtendedError, GetSaveFileNameW, OFN_EXPLORER, OFN_NOCHANGEDIR, OFN_OVERWRITEPROMPT,
    OFN_PATHMUSTEXIST, OPENFILENAMEW,
};

pub fn choose_path(window: &tauri::WebviewWindow, initial_folder: Option<&Path>, name: &str) -> io::Result<Option<PathBuf>> {
    let owner = window.hwnd().map_err(io::Error::other)?;
    let mut buffer = vec![0u16; 32_768];
    for (slot, unit) in buffer.iter_mut().zip(name.encode_utf16()) {
        *slot = unit;
    }
    let wide = |value: &str| value.encode_utf16().chain([0]).collect::<Vec<_>>();
    let filter = wide("Arquivo JSON (*.json)\0*.json\0");
    let title = wide("Salvar atributos como");
    let extension = wide("json");
    let folder = initial_folder.map(|path| path.as_os_str().encode_wide().chain([0]).collect::<Vec<_>>());

    let mut options = OPENFILENAMEW {
        lStructSize: size_of::<OPENFILENAMEW>() as u32,
        hwndOwner: owner.0 as _,
        lpstrFilter: filter.as_ptr(),
        nFilterIndex: 1,
        lpstrFile: buffer.as_mut_ptr(),
        nMaxFile: buffer.len() as u32,
        lpstrInitialDir: folder.as_ref().map_or(std::ptr::null(), |path| path.as_ptr()),
        lpstrTitle: title.as_ptr(),
        Flags: OFN_EXPLORER | OFN_NOCHANGEDIR | OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST,
        lpstrDefExt: extension.as_ptr(),
        ..Default::default()
    };

    // The synchronous dialog borrows these buffers until it closes.
    if unsafe { GetSaveFileNameW(&mut options) } == 0 {
        let error = unsafe { CommDlgExtendedError() };
        return if error == 0 { Ok(None) } else { Err(io::Error::other(format!("Falha ao abrir Salvar como (0x{error:X})."))) };
    }

    let len = buffer.iter().position(|&unit| unit == 0).unwrap_or(buffer.len());
    let path = PathBuf::from(OsString::from_wide(&buffer[..len]));
    if !path.is_absolute() || !path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("json")) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "Escolha um caminho de arquivo com extensão .json."));
    }
    Ok(Some(path))
}
