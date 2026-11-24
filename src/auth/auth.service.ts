import { HttpStatus, Injectable } from '@nestjs/common';
import { sign, verify } from 'jsonwebtoken';
import { JsonMessageException } from '../common/json-message.filter';

@Injectable()
export class AuthService {
    login(login: string, password: string) {
        if (login !== process.env.LOGIN || password !== process.env.PASS) {
            throw new JsonMessageException('Unauthorized', HttpStatus.UNAUTHORIZED);
        }

        return this.issueToken();
    }

    issueToken() {
        const secret = process.env.SECRET;
        if (!secret) {
            throw new Error('SECRET is required to sign tokens');
        }

        return {
            token: sign({ datetime: Date.now() }, secret, { expiresIn: '2h' }),
        };
    }

    checkToken(token: string | undefined): void {
        const secret = process.env.SECRET;
        if (!token || !secret) {
            throw new JsonMessageException('Unauthorized', HttpStatus.UNAUTHORIZED);
        }

        try {
            verify(token, secret);
        } catch {
            throw new JsonMessageException('Invalid or expired token', HttpStatus.BAD_REQUEST);
        }
    }
}

