import express from 'express'
import cors from 'cors'
import { config } from 'dotenv';
import  {connectDB}  from './config/db';
import authRoutes from '../src/routes/authRoutes.js'

config();
connectDB();
const app = express();
const PORT = 5001;

//body parsing middlewares
// app.use(cors())

app.use(cors({
  // Укажите адрес вашего React приложения (без слеша в конце!)
  origin: ['http://localhost:5173', 'http://192.168.85.110:5173'],
  // Разрешаем браузеру отправлять куки (JWT) на сервер
  credentials: true,
  // Разрешаем стандартные методы
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  // Разрешаем заголовки, если вы их используете
  allowedHeaders: ['Content-Type', 'Authorization']
}))
app.use(express.json());
app.use(express.urlencoded({extended:true}))


// app.use('/movies', movieRoutes)
app.use('/api/auth', authRoutes)
// app.use('/watchlist', watchListRoutes)


app.listen(PORT,()=>{
    console.log(`Server runnig on PORT ${PORT}`)
})