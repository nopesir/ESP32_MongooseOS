load('api_aws.js');
load('api_config.js');
load('api_events.js');
load('api_gcp.js');
load('api_gpio.js');
load('api_mqtt.js');
load('api_shadow.js');
load('api_timer.js');
load('api_sys.js');
load('api_watson.js');
load('api_rpc.js');
load('api_dht.js');
load('api_net.js');
load('api_esp32.js')

//let mdns_init = ffi('void mgos_esp_mdns_init(void)');


let coolPin = 26;
let warmPin = 25;
let tempPin = 18;
let flag = false;
let ssid = "SSID";
let password = "PASSWORD";
let data = {
  config: {
    wifi: {
      ap: { enable: true },
      sta: { enable: false }
    }
  }
};
let state = {
  id: "esp32",
  warm: false,
  cool: false,
  enabled: false,
  currTemp: 15,
  humidity: 39,
  percTemp: 15,
  desiredTemp: 15,
  upTime: 0
};
let online = false;

let myDHT = DHT.create(tempPin, DHT.DHT22);

state.id = Cfg.get('device.id');
ssid = Cfg.get('wifi.sta.ssid');

GPIO.set_mode(2, GPIO.MODE_OUTPUT);

//{HI} =c_{1}+c_{2}T+c_{3}R+c_{4}TR+c_{5}T^{2}+c_{6}R^{2}+c_{7}T^{2}R+c_{8}TR^{2}+c_{9}T^{2}R^{2}}

let state_topic = state.id + '/event/state';
let settemp_topic = state.id + '/event/setTemp';
let onoff_topic = state.id + '/event/onoff';

if (Cfg.get('wifi.ap.enable')) {
  GPIO.blink(2, 250, 250);
} else {
  GPIO.blink(2, 0, 0)
}

RPC.call(RPC.LOCAL, 'Config.Set', { config: { mqtt: { will_message: state.id }}}, function (resp, ud) {
  RPC.call(RPC.LOCAL, 'Config.Save', { reboot: false }, function (resp, ud) {
    print('Response:', JSON.stringify(resp));
  }, null);
}, null);



GPIO.set_button_handler(0, GPIO.PULL_UP, GPIO.INT_EDGE_NEG, 200, function (x) {
  RPC.call(RPC.LOCAL, 'Config.Set', data, function (resp, ud) {
    RPC.call(RPC.LOCAL, 'Config.Save', { reboot: true }, function (resp, ud) {
      print('Response:', JSON.stringify(resp));
    }, null);
  }, null);
}, null);

Event.addHandler(Net.STATUS_CONNECTED, function (ev, evdata, ud) {
  //mdns_init();

}, null);

//mos config-set wifi.sta.ssid=TISCALI-C9F405 wifi.sta.pass=C62AA7FC2C wifi.sta.enable=true wifi.ap.enable=false

let coolSW = function (cool) {
  let level = cool ? 0 : 1;
  GPIO.write(coolPin, level);
};

let warmSW = function (warm) {
  let level = warm ? 0 : 1;
  GPIO.write(warmPin, level);
};

GPIO.set_mode(coolPin, GPIO.MODE_OUTPUT);
GPIO.set_mode(warmPin, GPIO.MODE_OUTPUT);


coolSW(state.cool);
warmSW(state.warm);
GPIO.write(2, 0);

function updateSW() {

  // HERE: get temp and save in currTemp

  state.cool = false;
  state.warm = false;

  state.currTemp = myDHT.getTemp();
  state.humidity = myDHT.getHumidity();


  if ((state.humidity > 40) && (state.currTemp > 27)) {
    state.percTemp = -8.78469475556 + (1.61139411 * state.currTemp) + (2.33854883889 * state.humidity) +
      (-0.14611605 * state.currTemp * state.humidity) + (-0.012308094 * state.currTemp * state.currTemp) +
      (-0.0164248277778 * state.humidity * state.humidity) + (0.002211732 * state.currTemp * state.currTemp * state.humidity) +
      (0.00072546 * state.humidity * state.humidity * state.currTemp) +
      (-0.000003582 * state.humidity * state.humidity * state.currTemp * state.currTemp);
  } else {
    state.percTemp = state.currTemp;
  }

  if (state.enabled) {
    if (state.currTemp > state.desiredTemp) {
      state.cool = true;
    }
    if (state.currTemp < state.desiredTemp) {
      state.warm = true;
    }
  }
  coolSW(state.cool);
  warmSW(state.warm);

}

Timer.set(15000, Timer.REPEAT, updateSW, null);

// Update state every 10 second, and report to cloud if online
Timer.set(10000, Timer.REPEAT, function () {
  state.ram_free = Sys.free_ram();
  state.upTime = Sys.uptime();
  if (online)
    MQTT.pub(state_topic, JSON.stringify(state), 1, false);
}, null);


MQTT.sub(settemp_topic, function (conn, topic, msg) {
  let temp = JSON.parse(msg);
  if ((temp > -11) && (temp < 46)) {
    state.desiredTemp = temp;
    updateSW();
  }
});

MQTT.sub(onoff_topic, function (conn, topic, msg) {
  if (msg === "on") {
    state.enabled = true;
    updateSW();
  }
  if (msg === "off") {
    state.enabled = false;
    updateSW()
  }
});

// Only for DEBUG************************************/
/*MQTT.sub("event/getTemp", function(conn, topic, msg) {
  state.currTemp = JSON.parse(msg);
  updateSW();
});*/

MQTT.setEventHandler(function (conn, ev, edata) {
  if (ev === 202) {
    GPIO.write(2, 1);
    online = true;
  }
  else if (ev === 5) {
    GPIO.write(2, 0);
    online = false;
  }
}, null);

//***************************************************/

// Set up Shadow handler to synchronise device state with the shadow state
/*Shadow.addHandler(function (event, obj) {
  if (event === 'UPDATE_DELTA') {
    print('GOT DELTA:', JSON.stringify(obj));
    for (let key in obj) {  // Iterate over all keys in delta
      if (key === 'cool') {  // We know about the 'on' key. Handle it!
        state.cool = obj.cool;  // Synchronise the state
        coolSW(state.cool);   // according to the delta
      }
      if (key === 'warm') {  // We know about the 'on' key. Handle it!
        state.warm = obj.warm;  // Synchronise the state
        warmSW(state.warm);   // according to the delta
      }
    }
    reportState();  // Report our new state, hopefully clearing delta
  }
});

Event.on(Event.CLOUD_CONNECTED, function () {
  online = true;
  Shadow.update(0, { ram_total: Sys.total_ram() });
}, null);

Event.on(Event.CLOUD_DISCONNECTED, function () {
  online = false;
}, null);*/
