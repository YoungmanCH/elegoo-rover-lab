/*
 * @Author: ELEGOO
 * @Date: 2019-10-22 11:59:09
 * @LastEditTime: 2020-06-30 10:34:30
 * @LastEditors: Changhua
 * @Description: MPU6050 Data solution
 * @FilePath: 
 */

#include "I2Cdev.h"
#include "MPU6050.h"
#include "Wire.h"
#include "MPU6050_getdata.h"
#include <stdio.h>
#include <math.h>

MPU6050 accelgyro;
MPU6050_getdata MPU6050Getdata;

// static void MsTimer2_MPU6050getdata(void)
// {
//   sei();
//   int16_t ax, ay, az, gx, gy, gz;
//   accelgyro.getMotion6(&ax, &ay, &az, &gx, &gy, &gz); //Read the raw values of the six axes
//   float gyroz = -(gz - MPU6050Getdata.gzo) / 131 * 0.005f;
//   MPU6050Getdata.yaw += gyroz;
// }

bool MPU6050_getdata::MPU6050_dveInit(void)
{
  Wire.begin();
  uint8_t chip_id = 0x00;
  // 最大10回だけ試して必ず抜ける(cout を 0 で初期化。元コードは未初期化で脱出が不安定だった)
  for (uint8_t cout = 0; cout < 10; cout++)
  {
    chip_id = accelgyro.getDeviceID();
    Serial.print("MPU6050_chip_id: ");
    Serial.println(chip_id);
    if (chip_id != 0x00 && chip_id != 0xFF) // gyro を検出できたら初期化して成功
    {
      accelgyro.initialize();
      return false;
    }
    delay(10);
  }
  return true; // gyro 無しでも諦めて loop() へ進む(yaw は使わないので問題なし)
}
bool MPU6050_getdata::MPU6050_calibration(void)
{
  unsigned short times = 100; //Sampling times
  for (int i = 0; i < times; i++)
  {
    gz = accelgyro.getRotationZ();
    gzo += gz;
  }
  gzo /= times; //Calculate gyroscope offset

  // gzo = accelgyro.getRotationZ();
  return false;
}
bool MPU6050_getdata::MPU6050_dveGetEulerAngles(float *Yaw)
{
  unsigned long now = millis();           //Record the current time(ms)
  dt = (now - lastTime) / 1000.0;         //Caculate the derivative time(s)
  lastTime = now;                         //Record the last sampling time(ms)
  gz = accelgyro.getRotationZ();          //Read the raw values of the six axes
  float gyroz = -(gz - gzo) / 131.0 * dt; //z-axis angular velocity
  if (fabs(gyroz) < 0.05)                 //Clear instant zero drift signal
  {
    gyroz = 0.00;
  }
  agz += gyroz; //z-axis angular velocity integral
  *Yaw = agz;
  return false;
}
