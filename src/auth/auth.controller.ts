import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import Joi from 'joi';
import { JoiValidationPipe } from '../common/joi-validation.pipe';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

type LoginBody = { login: string; password: string };

const loginSchema = Joi.object<LoginBody>({
    login: Joi.string().required(),
    password: Joi.string().required(),
}).required();

@Controller()
export class AuthController {
    constructor(private readonly auth: AuthService) {}

    @Post('login')
    @HttpCode(HttpStatus.OK)
    login(@Body(new JoiValidationPipe(loginSchema)) body: LoginBody) {
        return this.auth.login(body.login, body.password);
    }

    @Get('refresh')
    @UseGuards(JwtAuthGuard)
    refresh() {
        return this.auth.issueToken();
    }
}

