// Fork local, cu 2 modificari fata de kniffen/TruckSim-Telemetry original
// (MIT): (1) eroarea include acum codul real Windows (GetLastError()) --
// originalul arunca mereu acelasi text generic, imposibil de diagnosticat
// de la distanta; (2) daca MapViewOfFile esueaza la marimea ceruta (32KB),
// mai incercam o data cu marimea REALA a obiectului de mapare (uneori mai
// mica, in functie de versiunea SDK-ului scs-sdk-plugin) inainte sa
// renuntam -- vezi EuroHaul: userul avea sdkActive mereu false desi
// pluginul scria date valide (confirmat manual din PowerShell/.NET).
#define NODE_API_NO_EXTERNAL_BUFFERS_ALLOWED true
#include <node_api.h>
#include <string.h>
#include <stdlib.h>

#if defined(_WIN32)
  #include <windows.h>
  #include <cstdio>
#else
  #include <sys/mman.h>
  #include <sys/stat.h>
  #include <fcntl.h>
  #include <unistd.h>
#endif

napi_value GetBuffer(napi_env env, napi_callback_info info) {
  char* sharedMemoryName;
  size_t argc = 1;
  size_t sharedMemoryNameSize;
  size_t sharedMemoryNameSizeRead;
  size_t sharedMemorySize = 32 * 1024; // 32 KB
  void* mappedFileView = nullptr;

  napi_status status;
  napi_value argv[1];

  // Retrieve arguments
  status = napi_get_cb_info(env, info, &argc, argv, NULL, NULL);
  if (status != napi_ok) {
    napi_throw_error(env, NULL, "Failed to retrieve arguments.");
    return nullptr;
  }

  // Get size of filename
  status = napi_get_value_string_utf8(env, argv[0], NULL, 0, &sharedMemoryNameSize);
  if (status != napi_ok) {
    napi_throw_error(env, NULL, "Failed to get memory-mapped filename size.");
    return nullptr;
  }

  // Allocate memory for filename
  sharedMemoryName     = (char*)calloc(sharedMemoryNameSize + 1, sizeof(char));
  sharedMemoryNameSize = sharedMemoryNameSize + 1;

  // Set the filename value
  status = napi_get_value_string_utf8(env, argv[0], sharedMemoryName, sharedMemoryNameSize, &sharedMemoryNameSizeRead);
  if (status != napi_ok) {
    free(sharedMemoryName);
    napi_throw_error(env, NULL, "Failed to set memory-mapped filename.");
    return nullptr;
  }

#if defined(_WIN32)
  size_t mappedSize = sharedMemorySize; // cate bytes chiar sunt valizi de copiat mai jos

  // Open the memory-mapped file
  HANDLE hMapFileSCSTelemetry = OpenFileMapping(FILE_MAP_READ, FALSE, sharedMemoryName);
  free(sharedMemoryName);
  if (!hMapFileSCSTelemetry) {
    char msg[160];
    snprintf(msg, sizeof(msg), "OpenFileMapping a esuat (GetLastError=%lu)", GetLastError());
    napi_throw_error(env, NULL, msg);
    return nullptr;
  }

  mappedFileView = MapViewOfFile(hMapFileSCSTelemetry, FILE_MAP_READ, 0, 0, sharedMemorySize);
  if (!mappedFileView) {
    DWORD firstErr = GetLastError();
    // Obiectul de mapare poate fi mai mic decat cei 32KB ceruti (variaza cu
    // versiunea scs-sdk-plugin) -- MapViewOfFile refuza sa mapeze MAI MULT
    // decat marimea reala. Reincercam cu 0 = "mapeaza tot ce exista".
    mappedFileView = MapViewOfFile(hMapFileSCSTelemetry, FILE_MAP_READ, 0, 0, 0);
    if (!mappedFileView) {
      DWORD secondErr = GetLastError();
      CloseHandle(hMapFileSCSTelemetry);
      char msg[200];
      snprintf(msg, sizeof(msg),
        "MapViewOfFile a esuat (32KB: GetLastError=%lu; marime completa: GetLastError=%lu)",
        firstErr, secondErr);
      napi_throw_error(env, NULL, msg);
      return nullptr;
    }
    // Am mapat cu succes doar "cat exista" -- aflam exact cat, ca sa nu
    // citim memorie nemapata (ar da crash) dincolo de regiunea reala.
    MEMORY_BASIC_INFORMATION mbi;
    if (VirtualQuery(mappedFileView, &mbi, sizeof(mbi)) != 0 && mbi.RegionSize > 0) {
      mappedSize = mbi.RegionSize < sharedMemorySize ? mbi.RegionSize : sharedMemorySize;
    } else {
      mappedSize = 0; // nu putem determina marimea in siguranta -- nu copiem nimic
    }
  }
#else // POSIX (Linux, macOS)
  int fd = shm_open(sharedMemoryName, O_RDONLY, 0400);
  free(sharedMemoryName);

  if (fd == -1) {
    napi_throw_error(env, NULL, "Failed to open POSIX shared memory");
    return nullptr;
  }

  mappedFileView = mmap(NULL, sharedMemorySize, PROT_READ, MAP_SHARED, fd, 0);
  if (mappedFileView == MAP_FAILED) {
    napi_throw_error(env, NULL, "Failed to mmap shared memory");
    return nullptr;
  }
  close(fd);
#endif

  // Create a new buffer for use in javascript
  napi_value buffer;
  void* data;
  status = napi_create_buffer(env, sharedMemorySize, &data, &buffer);
  if (status != napi_ok) {

#if defined(_WIN32)
    UnmapViewOfFile(mappedFileView);
    CloseHandle(hMapFileSCSTelemetry);
#else
    munmap(mappedFileView, sharedMemorySize);
#endif

    napi_throw_error(env, NULL, "Failed to create buffer");
    return nullptr;
  }

  // Copy data from memory-mapped file to the new buffer. Pe Windows,
  // `mappedSize` poate fi mai mic decat sharedMemorySize (vezi mai sus) --
  // restul bufferului ramane 0, adica "necunoscut/inactiv", nu memorie
  // nemapata citita la intamplare (ar da crash).
#if defined(_WIN32)
  memset(data, 0, sharedMemorySize);
  memcpy(data, mappedFileView, mappedSize);
#else
  memcpy(data, mappedFileView, sharedMemorySize);
#endif

  // Cleanup
#if defined(_WIN32)
  UnmapViewOfFile(mappedFileView);
  CloseHandle(hMapFileSCSTelemetry);
#else
  munmap(mappedFileView, sharedMemorySize);
#endif

  return buffer;
}

#define DECLARE_NAPI_METHOD(name, func)                                        \
  { name, 0, func, 0, 0, 0, napi_default, 0 }

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor desc = DECLARE_NAPI_METHOD("getBuffer", GetBuffer);
  napi_define_properties(env, exports, 1, &desc);

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)