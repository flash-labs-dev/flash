#include "../src/platform/windows/media_output.h"
#include "../src/platform/windows/png_writer.h"
#include "../src/core/clip_writer.h"
#include <cassert>
#include <fstream>
#include <iostream>
#include <wincodec.h>
#include <wrl/client.h>

int main() {
    const auto dir = std::filesystem::temp_directory_path() /
        (L"flash-publication-" + std::to_wstring(GetCurrentProcessId()));
    std::filesystem::create_directories(dir);
    const auto destination = dir / "fixture.png";
    const uint8_t pixels[] = {0, 0, 255, 255};
    flash::WritePng(destination.string(), pixels, 1, 1, 4);
    const auto bytes = [](const auto& path) {
        std::ifstream file(path, std::ios::binary);
        return std::string(std::istreambuf_iterator<char>(file), {});
    };
    const auto before = bytes(destination);
    bool refused = false;
    try { flash::WritePng(destination.string(), pixels, 1, 1, 4); }
    catch (const std::exception&) { refused = true; }
    assert(refused && bytes(destination) == before);

    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    {
        Microsoft::WRL::ComPtr<IWICImagingFactory> factory;
        assert(SUCCEEDED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory))));
        Microsoft::WRL::ComPtr<IWICBitmapDecoder> decoder;
        assert(SUCCEEDED(factory->CreateDecoderFromFilename(destination.c_str(), nullptr, GENERIC_READ, WICDecodeMetadataCacheOnLoad, &decoder)));
        Microsoft::WRL::ComPtr<IWICBitmapFrameDecode> frame;
        assert(SUCCEEDED(decoder->GetFrame(0, &frame)));
        UINT width = 0, height = 0;
        assert(SUCCEEDED(frame->GetSize(&width, &height)) && width == 1 && height == 1);
    }
    CoUninitialize();

    const auto failed = dir / "failed.mp4";
    try {
        flash::MediaOutput output(failed);
        std::ofstream(output.Partial()) << "unfinished";
        assert(!std::filesystem::exists(failed));
        throw std::runtime_error("injected writer failure");
    } catch (const std::exception&) {}
    assert(!std::filesystem::exists(failed));

    const auto existing = dir / "existing.mp4";
    std::ofstream(existing) << "keep this recording";
    flash::EncodedPacket packet{};
    packet.data = {0, 0, 0, 1};
    refused = false;
    try { flash::ClipWriter().Write(existing.string(), {packet}, {}, 2, 2, 30, "Fixture"); }
    catch (const std::exception&) { refused = true; }
    assert(refused && bytes(existing) == "keep this recording");
    const std::string game = reinterpret_cast<const char*>(u8"Pokémon 🎮");
    const auto dirUtf8 = dir.u8string();
    const auto generated = flash::ClipWriter::GenerateClipPath(
        std::string(dirUtf8.begin(), dirUtf8.end()), game);
    const auto generatedPath = std::filesystem::u8path(generated);
    assert(generatedPath.parent_path().filename() == std::filesystem::u8path(game));
    for (const auto& [input, folder] : {std::pair{"R.E.P.O.", "R.E.P.O"}, {" Game . ", "Game"},
                                         {"..", "Unknown"}, {"CON", "_CON"}}) {
        const auto path = flash::ClipWriter::GenerateClipPath(
            std::string(dirUtf8.begin(), dirUtf8.end()), input);
        assert(std::filesystem::u8path(path).parent_path().filename() == folder);
    }
    auto deep = dir;
    while (deep.wstring().size() < 275) deep /= L"long-path-segment";
    const auto extendedDeep = std::filesystem::path(L"\\\\?\\" + deep.wstring());
    std::filesystem::create_directories(extendedDeep);
    const auto longPng = deep / L"fixture.png";
    const auto longPngUtf8 = longPng.u8string();
    flash::WritePng(std::string(longPngUtf8.begin(), longPngUtf8.end()), pixels, 1, 1, 4);
    assert(std::filesystem::file_size(extendedDeep / L"fixture.png") > 0);
    std::filesystem::remove_all(extendedDeep);
    // A destination just under MAX_PATH whose temporary name is over it.
    std::wstring nearName(MAX_PATH - 5 - dir.wstring().size() - 5, L'n');
    const auto nearPng = dir / (nearName + L".png");
    assert(nearPng.wstring().size() == MAX_PATH - 5);
    const auto nearUtf8 = nearPng.u8string();
    flash::WritePng(std::string(nearUtf8.begin(), nearUtf8.end()), pixels, 1, 1, 4);
    assert(std::filesystem::file_size(nearPng) > 0);
    for (const auto& entry : std::filesystem::directory_iterator(dir))
        assert(entry.path().filename().string().find(".partial.") == std::string::npos);
    std::filesystem::remove_all(std::filesystem::path(L"\\\\?\\" + dir.wstring()));
    std::cout << "PASS: PNG reopens, existing PNG/MP4 unchanged, injected failure unpublished, no partials\n";
}
