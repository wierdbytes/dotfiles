// This code is originally from
// https://github.com/freedomtan/sensors/blob/master/sensors/sensors.m Here is
// the original code's license

// BSD 3-Clause License

// Copyright (c) 2016-2018, "freedom" Koan-Sin Tan
// All rights reserved.

// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:

// * Redistributions of source code must retain the above copyright notice, this
//   list of conditions and the following disclaimer.

// * Redistributions in binary form must reproduce the above copyright notice,
//   this list of conditions and the following disclaimer in the documentation
//   and/or other materials provided with the distribution.

// * Neither the name of the copyright holder nor the names of its
//   contributors may be used to endorse or promote products derived from
//   this software without specific prior written permission.

// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
// ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
// LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
// CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
// SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.

#include <Foundation/Foundation.h>
#include <IOKit/hidsystem/IOHIDEventSystemClient.h>
#include <stdio.h>

// Declarations from other IOKit source code

typedef struct __IOHIDEvent *IOHIDEventRef;
typedef struct __IOHIDServiceClient *IOHIDServiceClientRef;
#ifdef __LP64__
typedef double IOHIDFloat;
#else
typedef float IOHIDFloat;
#endif

IOHIDEventSystemClientRef
IOHIDEventSystemClientCreate(CFAllocatorRef allocator);
int IOHIDEventSystemClientSetMatching(IOHIDEventSystemClientRef client,
                                      CFDictionaryRef match);
int IOHIDEventSystemClientSetMatchingMultiple(IOHIDEventSystemClientRef client,
                                              CFArrayRef match);
IOHIDEventRef IOHIDServiceClientCopyEvent(IOHIDServiceClientRef, int64_t,
                                          int32_t, int64_t);
CFStringRef IOHIDServiceClientCopyProperty(IOHIDServiceClientRef service,
                                           CFStringRef property);
IOHIDFloat IOHIDEventGetFloatValue(IOHIDEventRef event, int32_t field);

// create a dict ref, like for temperature sensor {"PrimaryUsagePage":0xff00,
// "PrimaryUsage":0x5}
CFDictionaryRef matching(int page, int usage) {
  CFNumberRef nums[2];
  CFStringRef keys[2];

  keys[0] = CFStringCreateWithCString(0, "PrimaryUsagePage", 0);
  keys[1] = CFStringCreateWithCString(0, "PrimaryUsage", 0);
  nums[0] = CFNumberCreate(0, kCFNumberSInt32Type, &page);
  nums[1] = CFNumberCreate(0, kCFNumberSInt32Type, &usage);

  CFDictionaryRef dict = CFDictionaryCreate(
      0, (const void **)keys, (const void **)nums, 2,
      &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  return dict;
}

CFArrayRef getProductNames(CFDictionaryRef sensors) {
  IOHIDEventSystemClientRef system =
      IOHIDEventSystemClientCreate(kCFAllocatorDefault); // in CFBase.h = NULL
  // ... this is the same as using kCFAllocatorDefault or the return value from
  // CFAllocatorGetDefault()
  IOHIDEventSystemClientSetMatching(system, sensors);
  CFArrayRef matchingsrvs = IOHIDEventSystemClientCopyServices(
      system); // matchingsrvs = matching services

  long count = CFArrayGetCount(matchingsrvs);
  CFMutableArrayRef array =
      CFArrayCreateMutable(kCFAllocatorDefault, 0, &kCFTypeArrayCallBacks);

  for (int i = 0; i < count; i++) {
    IOHIDServiceClientRef sc =
        (IOHIDServiceClientRef)CFArrayGetValueAtIndex(matchingsrvs, i);
    CFStringRef name = IOHIDServiceClientCopyProperty(
        sc, CFSTR("Product")); // here we use ...CopyProperty
    if (name) {
      CFArrayAppendValue(array, name);
    } else {
      CFArrayAppendValue(array,
                         @"noname"); // @ gives a Ref like in "CFStringRef name"
    }
  }
  return array;
}

// from IOHIDFamily/IOHIDEventTypes.h
// e.g.,
// https://opensource.apple.com/source/IOHIDFamily/IOHIDFamily-701.60.2/IOHIDFamily/IOHIDEventTypes.h.auto.html

#define IOHIDEventFieldBase(type) (type << 16)
#define kIOHIDEventTypeTemperature 15
#define kIOHIDEventTypePower 25

CFArrayRef getPowerValues(CFDictionaryRef sensors) {
  IOHIDEventSystemClientRef system =
      IOHIDEventSystemClientCreate(kCFAllocatorDefault);
  IOHIDEventSystemClientSetMatching(system, sensors);
  CFArrayRef matchingsrvs = IOHIDEventSystemClientCopyServices(system);

  long count = CFArrayGetCount(matchingsrvs);
  CFMutableArrayRef array =
      CFArrayCreateMutable(kCFAllocatorDefault, 0, &kCFTypeArrayCallBacks);
  for (int i = 0; i < count; i++) {
    IOHIDServiceClientRef sc =
        (IOHIDServiceClientRef)CFArrayGetValueAtIndex(matchingsrvs, i);
    IOHIDEventRef event =
        IOHIDServiceClientCopyEvent(sc, kIOHIDEventTypePower, 0, 0);

    CFNumberRef value;
    if (event != 0) {
      double temp = IOHIDEventGetFloatValue(
          event, IOHIDEventFieldBase(kIOHIDEventTypePower));
      value = CFNumberCreate(kCFAllocatorDefault, kCFNumberDoubleType, &temp);
    } else {
      double temp = 0;
      value = CFNumberCreate(kCFAllocatorDefault, kCFNumberDoubleType, &temp);
    }
    CFArrayAppendValue(array, value);
  }
  return array;
}

CFArrayRef getThermalValues(CFDictionaryRef sensors) {
  IOHIDEventSystemClientRef system =
      IOHIDEventSystemClientCreate(kCFAllocatorDefault);
  IOHIDEventSystemClientSetMatching(system, sensors);
  CFArrayRef matchingsrvs = IOHIDEventSystemClientCopyServices(system);

  long count = CFArrayGetCount(matchingsrvs);
  CFMutableArrayRef array =
      CFArrayCreateMutable(kCFAllocatorDefault, 0, &kCFTypeArrayCallBacks);

  for (int i = 0; i < count; i++) {
    IOHIDServiceClientRef sc =
        (IOHIDServiceClientRef)CFArrayGetValueAtIndex(matchingsrvs, i);
    IOHIDEventRef event = IOHIDServiceClientCopyEvent(
        sc, kIOHIDEventTypeTemperature, 0, 0); // here we use ...CopyEvent

    CFNumberRef value;
    if (event != 0) {
      double temp = IOHIDEventGetFloatValue(
          event, IOHIDEventFieldBase(kIOHIDEventTypeTemperature));
      value = CFNumberCreate(kCFAllocatorDefault, kCFNumberDoubleType, &temp);
    } else {
      double temp = 0;
      value = CFNumberCreate(kCFAllocatorDefault, kCFNumberDoubleType, &temp);
    }
    CFArrayAppendValue(array, value);
  }
  CFRelease(matchingsrvs);
  return array;
}

void dumpValues(CFArrayRef values) {
  long count = CFArrayGetCount(values);
  for (int i = 0; i < count; i++) {
    CFNumberRef value = CFArrayGetValueAtIndex(values, i);
    double temp = 0.0;
    CFNumberGetValue(value, kCFNumberDoubleType, &temp);
    // NSLog(@"value = %lf\n", temp);
    printf("%0.1lf, ", temp);
  }
}

void dumpNames(CFArrayRef names, char *cat) {
  long count = CFArrayGetCount(names);
  for (int i = 0; i < count; i++) {
    NSString *name = (NSString *)CFArrayGetValueAtIndex(names, i);
    // NSLog(@"value = %lf\n", temp);
    // printf("%s (%s), ", [name UTF8String], cat);
    printf("%s, ", [name UTF8String]);
  }
}

NSArray *currentArray() {
  CFDictionaryRef currentSensors = matching(0xff08, 2);
  return CFBridgingRelease(getProductNames(currentSensors));
}

NSArray *voltageArray() {
  CFDictionaryRef currentSensors = matching(0xff08, 3);
  return CFBridgingRelease(getProductNames(currentSensors));
}

NSArray *thermalArray() {
  CFDictionaryRef currentSensors = matching(0xff00, 5);
  return CFBridgingRelease(getProductNames(currentSensors));
}

NSArray *returnCurrentValues() {
  CFDictionaryRef currentSensors = matching(0xff08, 2);
  return CFBridgingRelease(getPowerValues(currentSensors));
}

NSArray *returnVoltageValues() {
  CFDictionaryRef voltageSensors = matching(0xff08, 3);
  return CFBridgingRelease(getPowerValues(voltageSensors));
}

NSArray *returnThermalValues() {
  CFDictionaryRef currentSensors = matching(0xff00, 5);
  return CFBridgingRelease(getThermalValues(currentSensors));
}

// Function to filter sensor names by a specific property
CFArrayRef filterSensorNamesByProperty(CFArrayRef sensorNames,
                                       NSString *property) {
  CFMutableArrayRef filteredNames =
      CFArrayCreateMutable(kCFAllocatorDefault, 0, &kCFTypeArrayCallBacks);

  long count = CFArrayGetCount(sensorNames);
  for (int i = 0; i < count; i++) {
    NSString *name = (NSString *)CFArrayGetValueAtIndex(sensorNames, i);
    if ([name rangeOfString:property].location != NSNotFound) {
      CFArrayAppendValue(filteredNames, name);
    }
  }
  return filteredNames;
}

void printValuesAsArray(CFArrayRef sensorNames, CFArrayRef sensorValues) {
  dumpNames(sensorNames, "C");
  dumpValues(sensorValues);
}

void printFilteredValuesAsArrays(CFArrayRef sensorNames,
                                 CFArrayRef sensorValues, NSString *property) {
  CFArrayRef filteredNames = filterSensorNamesByProperty(sensorNames, property);
  long count = CFArrayGetCount(filteredNames);

  // Create an array to store filtered values
  CFMutableArrayRef filteredValues =
      CFArrayCreateMutable(kCFAllocatorDefault, 0, &kCFTypeArrayCallBacks);

  // Populate the filtered values array with corresponding values for filtered
  // names
  for (int i = 0; i < count; i++) {
    NSString *name = (NSString *)CFArrayGetValueAtIndex(filteredNames, i);
    CFIndex index = CFArrayGetFirstIndexOfValue(
        sensorNames, CFRangeMake(0, CFArrayGetCount(sensorNames)),
        (__bridge const void *)(name));
    if (index != -1 && index < CFArrayGetCount(sensorValues)) {
      CFNumberRef value = CFArrayGetValueAtIndex(sensorValues, index);
      CFArrayAppendValue(filteredValues, value);
    } else {
      // Handle error or provide default value if name not found in sensorNames
      printf("Value not found for %s\n", [name UTF8String]);
    }
  }

  // Print the filtered values array using the dumpValues function
  dumpNames(filteredNames, "C");
  dumpValues(filteredValues);

  // Release the memory allocated
  CFRelease(filteredValues);
  CFRelease(filteredNames);
}

void printValues(CFArrayRef sensorNames, CFArrayRef sensorValues) {
  long count = CFArrayGetCount(sensorNames);

  for (int i = 0; i < count; i++) {
    NSString *name = (NSString *)CFArrayGetValueAtIndex(sensorNames, i);
    printf("%s: ", [name UTF8String]);

    CFNumberRef value = CFArrayGetValueAtIndex(sensorValues, i);
    double temp = 0.0;
    CFNumberGetValue(value, kCFNumberDoubleType, &temp);
    printf("%0.1lf", temp);
    // Print newline if not the last line
    if (i < count - 1) {
      printf("\n");
    }
  }
}

// Function to filter and dump sensor names and values by a specific property
void printFilteredValues(CFArrayRef sensorNames, CFArrayRef sensorValues,
                         NSString *property) {
  CFArrayRef filteredNames = filterSensorNamesByProperty(sensorNames, property);
  long count = CFArrayGetCount(filteredNames);

  for (int i = 0; i < count; i++) {
    NSString *name = (NSString *)CFArrayGetValueAtIndex(filteredNames, i);
    printf("%s: ", [name UTF8String]);

    // Find the index of the filtered name in the original sensorNames array
    CFIndex index = CFArrayGetFirstIndexOfValue(
        sensorNames, CFRangeMake(0, CFArrayGetCount(sensorNames)),
        (__bridge const void *)(name));
    if (index != -1 && index < CFArrayGetCount(sensorValues)) {
      CFNumberRef value = CFArrayGetValueAtIndex(sensorValues, index);
      double temp = 0.0;
      CFNumberGetValue(value, kCFNumberDoubleType, &temp);
      printf("%0.1lf", temp);
      // Print newline if not the last line
      if (i < count - 1) {
        printf("\n");
      }
    } else {
      // Handle error or provide default value if name not found in sensorNames
      printf("Value not found, ");
    }
  }

  // Release the memory allocated
  CFRelease(filteredNames);
}

void printFilteredAverageTemp(CFArrayRef sensorNames, CFArrayRef sensorValues,
                              NSString *property) {
  CFArrayRef filteredNames = filterSensorNamesByProperty(sensorNames, property);
  long count = CFArrayGetCount(filteredNames);

  double sum = 0.0; // Variable to store the sum of sensor values

  for (int i = 0; i < count; i++) {
    NSString *name = (NSString *)CFArrayGetValueAtIndex(filteredNames, i);

    CFIndex index = CFArrayGetFirstIndexOfValue(
        sensorNames, CFRangeMake(0, CFArrayGetCount(sensorNames)),
        (__bridge const void *)(name));

    if (index != -1 && index < CFArrayGetCount(sensorValues)) {
      CFNumberRef value = CFArrayGetValueAtIndex(sensorValues, index);
      double temp = 0.0;
      CFNumberGetValue(value, kCFNumberDoubleType, &temp);
      sum += temp; // Accumulate the sensor values
    } else {
      // Handle error or provide default value if name not found in sensorNames
      printf("Value not found for %s, ", [name UTF8String]);
    }
  }

  double average = sum / count; // Calculate the average value

  printf("Average value of %s: %0.1lf", [property UTF8String], average);

  // Release the memory allocated for filteredNames
  CFRelease(filteredNames);
}

void printAverageTemp(CFArrayRef sensorValues) {
  long count = CFArrayGetCount(sensorValues);

  double sum = 0.0; // Variable to store the sum of sensor values

  for (int i = 0; i < count; i++) {
    CFNumberRef value = CFArrayGetValueAtIndex(sensorValues, i);
    double temp = 0.0;
    CFNumberGetValue(value, kCFNumberDoubleType, &temp);
    sum += temp; // Accumulate the sensor values
  }

  double average = sum / count; // Calculate the average value

  printf("Average value: %0.1lf", average);
}

void printFilteredHighestTemp(CFArrayRef sensorNames, CFArrayRef sensorValues,
                              NSString *property) {
  CFArrayRef filteredNames = filterSensorNamesByProperty(sensorNames, property);
  long count = CFArrayGetCount(filteredNames);

  double highestTemp = 0.0; // Variable to store the highest temperature
  NSString *sensorWithHighestTemp = @""; // Variable to store the name of the
                                         // sensor with the highest temperature

  for (int i = 0; i < count; i++) {
    NSString *name = (NSString *)CFArrayGetValueAtIndex(filteredNames, i);

    CFIndex index = CFArrayGetFirstIndexOfValue(
        sensorNames, CFRangeMake(0, CFArrayGetCount(sensorNames)),
        (__bridge const void *)(name));

    if (index != -1 && index < CFArrayGetCount(sensorValues)) {
      CFNumberRef value = CFArrayGetValueAtIndex(sensorValues, index);
      double temp = 0.0;
      CFNumberGetValue(value, kCFNumberDoubleType, &temp);
      if (temp > highestTemp) {
        highestTemp =
            temp; // Update highest temperature if current temperature is higher
        sensorWithHighestTemp =
            name; // Update sensor name with highest temperature
      }
    } else {
      // Handle error or provide default value if name not found in sensorNames
      printf("Value not found for %s, ", [name UTF8String]);
    }
  }

  printf("Highest value of %s: %0.1lf (from sensor: %s)", [property UTF8String],
         highestTemp, [sensorWithHighestTemp UTF8String]);

  // Release the memory allocated for filteredNames
  CFRelease(filteredNames);
}

void printHighestTemp(CFArrayRef sensorValues) {
  long count = CFArrayGetCount(sensorValues);

  double highestTemp = 0.0; // Variable to store the highest temperature

  for (int i = 0; i < count; i++) {
    CFNumberRef value = CFArrayGetValueAtIndex(sensorValues, i);
    double temp = 0.0;
    CFNumberGetValue(value, kCFNumberDoubleType, &temp);
    if (temp > highestTemp) {
      highestTemp =
          temp; // Update highest temperature if current temperature is higher
    }
  }

  printf("Highest value: %0.1lf", highestTemp);
}

void printThermalPressure() {
  NSProcessInfoThermalState thermalState =
      [[NSProcessInfo processInfo] thermalState];
  NSString *stateString;

  switch (thermalState) {
  case NSProcessInfoThermalStateNominal:
    stateString = @"Nominal";
    break;
  case NSProcessInfoThermalStateFair:
    stateString = @"Fair";
    break;
  case NSProcessInfoThermalStateSerious:
    stateString = @"Serious";
    break;
  case NSProcessInfoThermalStateCritical:
    stateString = @"Critical";
    break;
  default:
    stateString = @"Unknown";
    break;
  }

  printf("Thermal Pressure: %s", [stateString UTF8String]);
}

void printHelp() {
  printf("Usage: macos-temp-tool [options]\n");
  printf("Options:\n");
  printf("  -a                    Calculate average temperature.\n");
  printf("  -f [property]         Filter data by property.\n");
  printf("  -r [interval]         Repeat the operation with a specified "
         "interval.\n");
  printf("  -p                    Print thermal pressure, not compatible with "
         "the other arguments.\n");
  printf("  -m                    Print the highest temperature, not "
         "compatible with -a, -p, or -array.\n");
  printf("  -array                Print as two arrays, one with names, and one "
         "with values instead of a table. Not available with -a.\n");
  printf("  -h                    Print this help message.\n");
  printf("  -l                    Print the license.\n");
}

void printLicense() {
  printf("BSD 3-Clause License\n\n");
  printf("Copyright (c) 2016-2018, \"freedom\" Koan-Sin Tan\n");
  printf("All rights reserved.\n\n");
  printf(
      "Redistribution and use in source and binary forms, with or without\n");
  printf("modification, are permitted provided that the following conditions "
         "are met:\n\n");
  printf("* Redistributions of source code must retain the above copyright "
         "notice, this\n");
  printf("  list of conditions and the following disclaimer.\n\n");
  printf("* Redistributions in binary form must reproduce the above copyright "
         "notice,\n");
  printf("  this list of conditions and the following disclaimer in the "
         "documentation\n");
  printf("  and/or other materials provided with the distribution.\n\n");
  printf("* Neither the name of the copyright holder nor the names of its\n");
  printf("  contributors may be used to endorse or promote products derived "
         "from\n");
  printf("  this software without specific prior written permission.\n\n");
  printf("THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "
         "\"AS IS\"\n");
  printf("AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED "
         "TO, THE\n");
  printf("IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR "
         "PURPOSE ARE\n");
  printf("DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS "
         "BE LIABLE\n");
  printf("FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR "
         "CONSEQUENTIAL\n");
  printf("DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE "
         "GOODS OR\n");
  printf("SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) "
         "HOWEVER\n");
  printf("CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT "
         "LIABILITY,\n");
  printf("OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT "
         "OF THE USE\n");
  printf(
      "OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.\n");
}

int main(int argc, char *argv[]) {
  // Create default values
  NSString *property = nil;
  BOOL calculateAverage = NO;
  BOOL repeat = NO;
  BOOL printAsArray = NO;
  BOOL printPressure = NO;
  BOOL printHighest = NO;
  BOOL printHelpFlag = NO;
  BOOL printLicenseFlag = NO;
  int repeatInterval = 0; // in microseconds

  // Loop through command-line arguments to determine actions
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "-a") == 0) {
      calculateAverage = YES;
    } else if (strcmp(argv[i], "-f") == 0) {
      if (i + 1 < argc) {
        property = [NSString stringWithUTF8String:argv[i + 1]];
        i++; // Skip next argument (property)
      } else {
        printf("Error: Missing argument for -f\n");
        return 1;
      }
    } else if (strcmp(argv[i], "-r") == 0) {
      repeat = YES;
      if (i + 1 < argc) {
        repeatInterval =
            atoi(argv[i + 1]) * 1000000; // Convert seconds to microseconds
        i++;                             // Skip next argument (interval)
      } else {
        printf("Error: Missing argument for -r\n");
        return 1;
      }
    } else if (strcmp(argv[i], "-array") == 0) {
      printAsArray = YES;
    } else if (strcmp(argv[i], "-p") == 0) {
      printPressure = YES;
    } else if (strcmp(argv[i], "-m") == 0) {
      printHighest = YES;
    } else if (strcmp(argv[i], "-h") == 0) {
      printHelpFlag = YES;
    } else if (strcmp(argv[i], "-l") == 0) {
      printLicenseFlag = YES;
    } else {
      printf("Error: Invalid argument: %s\n", argv[i]);
      return 1;
    }
  }

  // Retrieve sensor data
  CFDictionaryRef thermalSensors = matching(0xff00, 5);
  CFArrayRef thermalNames = getProductNames(thermalSensors);
  CFArrayRef thermalValues = getThermalValues(thermalSensors);

  // Check if -array is used with -a, show warning if so
  if (printAsArray && (calculateAverage || printHighest)) {
    printf("Error: -array cannot be used together with -a or -h\n");
    return 1;
  }

  // Check if printpressure is used with any other argument
  if (printPressure &&
      (calculateAverage || property || printAsArray || printHighest)) {
    printf("Error: -p cannot be used with any other argument\n");
    return 1;
  }

  if (printHelpFlag && (calculateAverage || property || printAsArray ||
                        printHighest || printPressure || repeat)) {
    printf("Error: -h cannot be used with any other argument\n");
    return 1;
  }

  if (printHelpFlag && (calculateAverage || property || printAsArray ||
                        printHighest || printPressure || repeat)) {
    printf("Error: -l cannot be used with any other argument\n");
    return 1;
  }

  // Check if printhighest is used with -a
  if (printHighest && calculateAverage) {
    printf("Error: -m cannot be used with -a\n");
    return 1;
  }

  // Main loop to perform actions
  do {
    if (printHelpFlag) {
      printHelp();
    } else if (printPressure) {
      printThermalPressure();
    } else if (printLicenseFlag) {
      printLicense();
    } else if (calculateAverage) {
      if (property) {
        printFilteredAverageTemp(thermalNames, thermalValues, property);
      } else {
        printAverageTemp(thermalValues);
      }
    } else if (printHighest) {
      if (property) {
        printFilteredHighestTemp(thermalNames, thermalValues, property);
      } else {
        printHighestTemp(thermalValues);
      }
    } else if (property) {
      if (printAsArray) {
        printFilteredValuesAsArrays(thermalNames, thermalValues, property);
      } else {
        printFilteredValues(thermalNames, thermalValues, property);
      }
    } else {
      if (printAsArray) {
        printValuesAsArray(thermalNames, thermalValues);
      } else {
        printValues(thermalNames, thermalValues);
      }
    }
    printf("\n");
    fflush(stdout);
    if (repeat) {
      usleep(repeatInterval);
    }
  } while (repeat);

  // Release the memory allocated for thermalNames, thermalValues, and
  // thermalSensors
  CFRelease(thermalNames);
  CFRelease(thermalValues);
  CFRelease(thermalSensors);

  return 0;
}
