import serial
import time

PORT = '/dev/ttyUSB0'
BAUD = 9600

with serial.Serial(PORT, BAUD, timeout=0.1) as ser:
    print("Escuchando... (CTRL+C para salir)")
    while True:
        if ser.in_waiting:
            data = ser.read(ser.in_waiting)
            print(repr(data))
        time.sleep(0.01)
