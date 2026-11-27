#pragma once

#ifdef _WIN32
#include <Windows.h>
#include <atomic>
#include <cstdint>
#include <filesystem>
#include <stdexcept>
#include <string>

namespace flash {

inline std::filesystem::path WindowsFilePath(const std::filesystem::path& path) {
    const auto absolute = std::filesystem::absolute(path).wstring();
    if (absolute.size() < MAX_PATH || absolute.rfind(L"\\\\?\\", 0) == 0) return path;
    if (absolute.rfind(L"\\\\", 0) == 0)
        return std::filesystem::path(L"\\\\?\\UNC\\" + absolute.substr(2));
    return std::filesystem::path(L"\\\\?\\" + absolute);
}

// Publish only a finished file. MoveFileW refuses an existing destination, even
// if another caller created it after the main process reserved the name.
class MediaOutput {
public:
    explicit MediaOutput(const std::filesystem::path& destination) : destination_(WindowsFilePath(destination)) {
        try {
            // exists() throws too, e.g. on an unreachable network share.
            if (std::filesystem::exists(destination_)) throw std::runtime_error("output file already exists");
            if (!destination_.parent_path().empty()) std::filesystem::create_directories(destination_.parent_path());
        } catch (const std::filesystem::filesystem_error& error) {
            throw std::runtime_error(std::string(error.what()) + " (Win32 " + std::to_string(error.code().value()) + ")");
        }
        static std::atomic<uint64_t> next{0};
        for (;;) {
            // The longer temporary name can cross MAX_PATH when the destination does not.
            partial_ = WindowsFilePath(destination_.parent_path() / (destination_.stem().wstring() + L"." +
                std::to_wstring(GetCurrentProcessId()) + L"." + std::to_wstring(next++) + L".partial" + destination_.extension().wstring()));
            HANDLE file = CreateFileW(partial_.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
            if (file != INVALID_HANDLE_VALUE) { CloseHandle(file); break; }
            const DWORD error = GetLastError();
            if (error != ERROR_FILE_EXISTS) throw std::runtime_error("could not reserve temporary output file (Win32 " + std::to_string(error) + ")");
        }
    }
    ~MediaOutput() {
        std::error_code ignored;
        std::filesystem::remove(partial_, ignored);
    }
    MediaOutput(const MediaOutput&) = delete;
    MediaOutput& operator=(const MediaOutput&) = delete;
    const std::filesystem::path& Partial() const { return partial_; }
    void Publish() {
        HANDLE file = CreateFileW(partial_.c_str(), GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
                                  nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (file == INVALID_HANDLE_VALUE) {
            const DWORD error = GetLastError();
            throw std::runtime_error("could not flush output (Win32 " + std::to_string(error) + ")");
        }
        const BOOL flushed = FlushFileBuffers(file);
        const DWORD flushError = flushed ? ERROR_SUCCESS : GetLastError();
        CloseHandle(file);
        if (!flushed) throw std::runtime_error("could not flush output (Win32 " + std::to_string(flushError) + ")");
        if (!MoveFileW(partial_.c_str(), destination_.c_str())) {
            const DWORD error = GetLastError();
            throw std::runtime_error("could not publish output; destination may already exist (Win32 " + std::to_string(error) + ")");
        }
    }
private:
    std::filesystem::path destination_, partial_;
};

} // namespace flash
#endif
